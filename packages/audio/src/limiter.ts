/**
 * 재생과 WAV 저장이 함께 쓰는 리미터. 악기별 음량·겹친 트랙으로 합친 소리가 문턱(−3dB)을 넘으면
 * 두 채널을 같은 비율로 줄인다. 문턱 아래에서는 손대지 않는다(이득이 정확히 1).
 *
 * 미리 보기(lookahead): 소리를 latency 샘플만큼 늦춰 내보내고, 그동안 다가올 봉우리를 보고 미리 줄여 둔다.
 * 그래서 큰 첫 음·타격음처럼 짧은 봉우리도 문턱 둘레를 넘지 않는다. 어떤 샘플을 내보낼 때의 이득은
 * 그 샘플이 들어온 뒤 latency 동안의 "필요한 이득" 최솟값들을 latency 길이로 평균한 값이라,
 * 그 샘플에 필요한 이득보다 늘 작거나 같고(넘지 않음) 부드럽게 바뀐다(딸깍 소리 없음).
 * 늦춘 만큼 재생선은 그만큼 늦춰 그리고, WAV는 앞을 잘라 맞춘다.
 *
 * 실시간 재생은 이 클래스의 소스를 그대로 AudioWorklet에 올려 쓰므로(limiterWorkletSource),
 * 이 클래스는 바깥 이름(모듈 상수·다른 함수)을 쓰지 않는다.
 */
export class PeakLimiter {
  /** 늦추는 샘플 수 (미리 보는 길이) */
  readonly latency: number;
  private readonly threshold: number;
  private readonly slope: number;
  private readonly release: number;
  /** 봉우리 높이: 넘으면 바로 올라가고, 내려갈 때는 release로 천천히 */
  private envelope = 0;
  /** 들어온 샘플 번호 */
  private count = 0;
  /** 늦춰 둔 입력 (latency칸 고리) */
  private readonly delayLeft: Float32Array;
  private readonly delayRight: Float32Array;
  /** 최근 latency+1 샘플의 필요한 이득 최솟값을 내는 단조 덱 (번호·값, 고리) */
  private readonly dequeAt: Float64Array;
  private readonly dequeGain: Float64Array;
  private head = 0;
  private size = 0;
  /** 최솟값들을 평균 내는 상자 (latency칸 고리), 그 합, 1보다 작은 칸 수 */
  private readonly box: Float64Array;
  private sum: number;
  private below = 0;

  constructor(sampleRate: number, thresholdDb = -3, ratio = 20, lookaheadSeconds = 0.003, releaseSeconds = 0.1) {
    this.threshold = Math.pow(10, thresholdDb / 20);
    // 문턱을 넘은 만큼을 1/ratio로 줄인다: 줄일 dB = 넘은 dB × (1 − 1/ratio)
    this.slope = 1 - 1 / ratio;
    this.release = Math.exp(-1 / (releaseSeconds * sampleRate));
    this.latency = Math.max(1, Math.round(lookaheadSeconds * sampleRate));
    this.delayLeft = new Float32Array(this.latency);
    this.delayRight = new Float32Array(this.latency);
    this.dequeAt = new Float64Array(this.latency + 2);
    this.dequeGain = new Float64Array(this.latency + 2);
    this.box = new Float64Array(this.latency).fill(1);
    this.sum = this.latency;
  }

  /** left·right의 [start, start + count)를 그 자리에서 바꾼다: latency 샘플 전 입력을 줄여서 내보낸다 */
  process(left: Float32Array, right: Float32Array, start = 0, count = left.length - start): void {
    const end = start + count;
    const lag = this.latency;
    const cap = this.dequeAt.length;
    for (let i = start; i < end; i++) {
      const l = left[i]!;
      const r = right[i]!;
      const n = this.count++;
      this.envelope = Math.max(Math.abs(l), Math.abs(r), this.envelope * this.release);
      const need = this.envelope > this.threshold ? Math.pow(this.threshold / this.envelope, this.slope) : 1;
      // 덱: 뒤에서 need보다 크거나 같은 값은 버리고 넣는다, 앞에서 [n − lag, n] 밖으로 나간 것은 뺀다
      while (this.size > 0 && this.dequeGain[(this.head + this.size - 1) % cap]! >= need) this.size--;
      const tail = (this.head + this.size) % cap;
      this.dequeAt[tail] = n;
      this.dequeGain[tail] = need;
      this.size++;
      while (this.dequeAt[this.head]! < n - lag) {
        this.head = (this.head + 1) % cap;
        this.size--;
      }
      const held = this.dequeGain[this.head]!;
      // 상자 평균: 칸이 모두 1이면 정확히 1 (합의 반올림 오차가 남지 않게)
      const slot = n % lag;
      const old = this.box[slot]!;
      if (old < 1) this.below--;
      if (held < 1) this.below++;
      this.box[slot] = held;
      this.sum += held - old;
      let gain = 1;
      if (this.below === 0) this.sum = lag;
      else gain = this.sum / lag;
      // 늦춘 입력을 꺼내 내보내고 지금 입력을 넣는다
      const at = n % lag;
      const outL = this.delayLeft[at]!;
      const outR = this.delayRight[at]!;
      this.delayLeft[at] = l;
      this.delayRight[at] = r;
      left[i] = gain === 1 ? outL : outL * gain;
      right[i] = gain === 1 ? outR : outR * gain;
    }
  }
}

/** 실시간 재생용 AudioWorklet 모듈 소스. PeakLimiter를 그대로 쓴다 (입력 2채널 → 출력 2채널) */
export function limiterWorkletSource(name: string): string {
  return `const PeakLimiter = ${PeakLimiter.toString()};
class LimiterProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.limiter = new PeakLimiter(sampleRate); }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0], right = output[1] ?? output[0];
    // 입력이 없어도 늦춰 둔 소리는 마저 내보낸다
    if (!input || input.length === 0) { left.fill(0); right.fill(0); }
    else { left.set(input[0]); right.set(input[1] ?? input[0]); }
    this.limiter.process(left, right, 0, left.length);
    return true;
  }
}
registerProcessor(${JSON.stringify(name)}, LimiterProcessor);
`;
}
