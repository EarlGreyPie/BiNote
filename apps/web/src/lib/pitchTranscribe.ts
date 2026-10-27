import type { TimedNote } from "@mmlce/midi";

/**
 * 브라우저 안 받아 적기 (실험실): Spotify basic-pitch(Apache-2.0) 모델로 음원에서 음을 찾는다.
 * 모델은 앱과 같은 곳(basic-pitch/model.json)에서 처음 쓸 때 받는다. 피아노 등 한 악기 음원에서 가장 잘 맞고,
 * 여러 악기가 섞이면 틀린 음이 많아진다. 결과는 초 단위 음이고 곡에 놓는 것은 MIDI 불러오기 창이 한다
 */

/** basic-pitch 입력: 22050 Hz 모노 */
export const PITCH_SAMPLE_RATE = 22050;
/** 모델 프레임 수 / 초 (basic-pitch: 22050 / 256) */
const FRAMES_PER_SECOND = Math.floor(PITCH_SAMPLE_RATE / 256);

export interface PitchOptions {
  /** 음 시작으로 볼 확신 (0~1, 낮을수록 음을 많이 찾는다). basic-pitch 기본 0.5 */
  readonly onset: number;
  /** 울리는 동안으로 볼 확신 (0~1). basic-pitch 기본 0.3 */
  readonly frame: number;
  /** 이보다 짧은 음은 버린다 (ms). basic-pitch 기본 5프레임 ≈ 58 ms */
  readonly minMs: number;
  /** 찾을 높이 범위 (MIDI 번호). 악기 음역 밖 잡음을 줄인다 */
  readonly low: number;
  readonly high: number;
}

export const DEFAULT_PITCH_OPTIONS: PitchOptions = { onset: 0.5, frame: 0.3, minMs: 58, low: 21, high: 108 };

export interface PitchRequest {
  readonly samples: Float32Array;
  readonly modelUrl: string;
  readonly options: PitchOptions;
}

const midiToHz = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

/**
 * 브라우저 안에서 받아 적을 수 있는 음원 한도. 풀어 둔 소리와 모델 출력이 모두 메모리에 올라가므로
 * 너무 긴 음원은 탭(특히 아이패드)이 멈추기 전에 거절한다. 10분 = 22050 Hz 모노로 약 53 MB
 */
export const PITCH_MAX_SECONDS = 10 * 60;
export const PITCH_MAX_BYTES = 200 * 1024 * 1024;

/** 음원이 한도를 넘음 */
export class PitchTooLong extends Error {
  readonly maxMinutes = PITCH_MAX_SECONDS / 60;
}

/** 파일 크기(바이트)·길이(초)가 한도 안인지 본다. 길이를 아직 모르면 크기만 본다 */
export function checkPitchInput(bytes: number, seconds?: number): void {
  if (bytes > PITCH_MAX_BYTES) throw new PitchTooLong();
  if (seconds !== undefined && !(seconds <= PITCH_MAX_SECONDS)) throw new PitchTooLong();
}

type BasicPitchModel = InstanceType<typeof import("@spotify/basic-pitch").BasicPitch>;
/** 모델은 주소마다 한 번만 읽어 둔다 (받아 적을 때마다 새로 읽지 않는다) */
const models = new Map<string, Promise<BasicPitchModel>>();

/** 음을 찾는다. 진행률은 0~1 */
export async function transcribePitch(request: PitchRequest, onProgress: (progress: number) => void): Promise<TimedNote[]> {
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import("@spotify/basic-pitch");
  let loading = models.get(request.modelUrl);
  if (!loading) {
    const made = new BasicPitch(request.modelUrl);
    loading = made.model.then(() => made);
    models.set(request.modelUrl, loading);
    // 읽기에 실패하면 다음에 다시 읽는다
    loading.catch(() => models.delete(request.modelUrl));
  }
  const model = await loading;
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await model.evaluateModel(
    request.samples,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    (p) => onProgress(Math.min(0.99, p)),
  );
  const o = request.options;
  const minFrames = Math.max(1, Math.round((o.minMs / 1000) * FRAMES_PER_SECOND));
  // 높이 범위는 반음 반 칸 바깥까지 둔다 (경계 음이 잘리지 않게)
  const events = outputToNotesPoly(frames, onsets, o.onset, o.frame, minFrames, true, midiToHz(o.high + 0.5), midiToHz(o.low - 0.5), true);
  onProgress(1);
  return noteFramesToTime(events).map((n) => ({
    start: n.startTimeSeconds,
    dur: n.durationSeconds,
    pitch: n.pitchMidi,
    velocity: Math.min(127, Math.max(1, Math.round(n.amplitude * 127))),
  }));
}

/**
 * 음원 길이(초)를 다 풀지 않고 머리 정보로 알아낸다 (브라우저 미디어 요소). 모르면 undefined.
 * 크기는 작아도 몇 시간짜리인 압축 음원을 풀기 전에 거르려고 쓴다
 */
export function mediaDuration(file: Blob, timeoutMs = 5000): Promise<number | undefined> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = (value: number | undefined) => {
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

/**
 * 음원 파일을 basic-pitch 입력(22050 Hz 모노)으로 푼다. 화면 쪽에서만 (워커에는 오디오 디코더가 없다). 한도를 넘으면 PitchTooLong.
 * 크기와 머리 정보의 길이를 풀기 전에 먼저 보고, 머리 정보가 없는 음원은 푼 뒤 다시 본다
 */
export async function decodeForPitch(file: Blob, durationOf: (file: Blob) => Promise<number | undefined> = mediaDuration): Promise<Float32Array> {
  checkPitchInput(file.size);
  const head = await durationOf(file);
  if (head !== undefined) checkPitchInput(file.size, head);
  const data = await file.arrayBuffer();
  const probe = new OfflineAudioContext(1, 1, PITCH_SAMPLE_RATE);
  const decoded = await probe.decodeAudioData(data);
  checkPitchInput(file.size, decoded.duration);
  const length = Math.max(1, Math.ceil(decoded.duration * PITCH_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(1, length, PITCH_SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

/** 모델 주소: 앱 주소 기준 basic-pitch/model.json (빌드할 때 패키지에서 옮겨 둔다) */
export function pitchModelUrl(): string {
  return new URL("basic-pitch/model.json", document.baseURI).href;
}
