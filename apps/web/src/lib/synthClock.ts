/**
 * 신스 시계 맞추기.
 * 신스(워크릿)는 오디오 시계를 읽지 않고, 만들어질 때의 시각에 자기가 만든 소리 길이를 더해 가는 자기 시계로
 * 예약한 음을 낸다. 브라우저가 오디오 시계는 흘리면서 신스를 부르지 않은 때가 있으면(아이패드에서 오디오가
 * 멈췄다 돌아올 때 등) 그만큼 신스 시계가 뒤처지고, 그 뒤로 예약한 음이 모두 그만큼 늦게 난다. 다시 맞춰지지 않아
 * 일이 생길 때마다 더 벌어진다. 재생선·메트로놈·원곡은 오디오 시계를 쓰므로 음만 뒤로 밀린다.
 * 여기서는 신스에 시각을 물어 뒤처진 만큼을 재고(synthLagOf), 예약 시각에서 그만큼을 뺀다(SynthClock).
 */

/** 신스 시계 재기 한 번: 물어본 때·답을 받은 때의 오디오 시계와, 신스가 답한 자기 시계 (모두 초) */
export interface ClockPing {
  sent: number;
  received: number;
  synth: number;
}

/** 물어보고 답을 받기까지 오디오 시계가 이만큼(초) 넘게 갔으면 그 재기는 쓰지 않는다 (가운데로 어림한 값이 흐려진다) */
export const PING_MAX_ROUND = 0.05;
/** 뒤처짐이 이만큼(초) 안 되면 맞지 않은 것으로 치지 않는다 (재는 오차) */
export const SYNTH_LAG_SLACK = 0.008;
/** 이미 맞춰 둔 값과 이만큼(초) 넘게 달라야 바꾼다 (재생 중에 값이 조금씩 흔들려 음 간격이 떨리지 않게) */
export const SYNTH_LAG_STEP = 0.004;

/**
 * 신스 시계가 오디오 시계보다 뒤처진 시간(초, 앞서면 음수). 신스는 물어본 때와 답을 받은 때 사이에 답했으므로,
 * 그 사이가 가장 짧은 재기의 가운데 시각에서 신스 시계를 뺀다. 쓸 만한 재기가 없으면 undefined
 */
export function synthLagOf(pings: readonly ClockPing[]): number | undefined {
  let best: ClockPing | undefined;
  for (const p of pings) {
    const round = p.received - p.sent;
    if (!(round >= 0) || round > PING_MAX_ROUND || !Number.isFinite(p.synth)) continue;
    if (!best || round < best.received - best.sent) best = p;
  }
  return best ? (best.sent + best.received) / 2 - best.synth : undefined;
}

/** 잰 값(measured)을 받아 다음에 쓸 뒤처짐을 정한다. 오차만큼 작으면 0, 지금 값과 거의 같으면 지금 값 그대로 */
export function nextSynthLag(current: number, measured: number): number {
  const next = Math.abs(measured) < SYNTH_LAG_SLACK ? 0 : measured;
  return Math.abs(next - current) <= SYNTH_LAG_STEP ? current : next;
}

/** 채널마다 기억해 둘 최근 켜기 수 (정지할 때 끊을 앞날의 켜기는 미리 예약한 0.3초 안의 것뿐이다) */
const RECENT_ONS = 64;

/**
 * 오디오 시계 시각을 신스 시계 시각으로 바꾼다 (뒤처진 만큼 뺀다).
 * 재생 중에 뒤처짐 값이 바뀌어도 한 음의 끄기·끊기가 그 음의 켜기보다 앞서지 않게 한다
 * (끄기가 먼저 처리되면 그 음이 꺼지지 않고 계속 울린다)
 */
export class SynthClock {
  /** 신스 시계가 오디오 시계보다 뒤처진 시간(초) */
  lag = 0;
  /** 채널·음마다 마지막으로 켠 신스 시각 */
  private readonly lastOn = new Map<number, number>();
  /** 채널마다 최근 켜기: 받은 오디오 시각과 신스에 넣은 시각 */
  private readonly recent = new Map<number, { time: number; sent: number }[]>();

  /** 악기 바꾸기·높이 옮기기 등 */
  at(time: number): number {
    return time - this.lag;
  }

  on(channel: number, note: number, time: number): number {
    const sent = time - this.lag;
    this.lastOn.set(channel * 128 + note, sent);
    const list = this.recent.get(channel) ?? [];
    list.push({ time, sent });
    if (list.length > RECENT_ONS) list.shift();
    this.recent.set(channel, list);
    return sent;
  }

  off(channel: number, note: number, time: number): number {
    return Math.max(time - this.lag, this.lastOn.get(channel * 128 + note) ?? -Infinity);
  }

  /** 채널 소리 끊기. 같은 시각에 켠 음을 끊는 것이면(정지) 그 켜기를 넣은 시각 그대로 쓴다 */
  cut(channel: number, time: number): number {
    const list = this.recent.get(channel) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.time === time) return list[i]!.sent;
    return time - this.lag;
  }
}
