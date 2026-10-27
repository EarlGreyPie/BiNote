import type { GameProfile, Song } from "@mmlce/core";
import type { BookPlan, BookProgress, FewerBooks } from "@mmlce/mml";
import { fewerOf, planSplit, type BooksRequest, type SplitRequest } from "./splitPlan";

export { fewerOf, planSplit, type BooksRequest, type SplitRequest };
import type { Schedule, SlotPatch } from "@mmlce/audio/browser";
import { WorkerJob } from "./workerJob";
import { transcribePitch, type PitchRequest } from "./pitchTranscribe";
import type { TimedNote } from "@mmlce/midi";

/** 악보책 나누기 (Web Worker) */
export function splitJob(makeWorker = workerMaker(() => new Worker(new URL("./split.worker.ts", import.meta.url), { type: "module" }))) {
  return new WorkerJob<SplitRequest, BookPlan, BookProgress>(makeWorker, planSplit);
}

/** 트랙 사이 음을 고르게 옮겨 악보책 권 수를 줄일 수 있는지 (Web Worker). 줄일 수 없으면 undefined */
export function booksJob(makeWorker = workerMaker(() => new Worker(new URL("./books.worker.ts", import.meta.url), { type: "module" }))) {
  return new WorkerJob<BooksRequest, FewerBooks | undefined>(makeWorker, fewerOf);
}


export interface WavRequest {
  readonly schedule: Schedule;
  readonly patches: readonly SlotPatch[];
  /** 사운드팩 파일 바이트 */
  readonly packs: readonly { readonly id: string; readonly bank: number; readonly bytes: ArrayBuffer }[];
  /** 전체 음량 (재생과 같은 배율. 리미터도 재생과 같이 거친다) */
  readonly volume?: number;
}

export interface WavResult {
  readonly wav: ArrayBuffer;
}

/** 사운드팩으로 일정을 그려 WAV 파일 바이트로. 신스 라이브러리는 이때 불러온다 */
export async function renderWavFile(request: WavRequest, onProgress: (fraction: number) => void): Promise<WavResult> {
  const { loadSoundBank, renderPatched, toWav } = await import("@mmlce/audio");
  // 불러오는 사이 취소됐으면 여기서 멈춘다 (화면 쪽 계산일 때 진행률 콜백이 던진다)
  onProgress(0);
  const packs = request.packs.map((p) => ({ id: p.id, bank: p.bank, soundBank: loadSoundBank(p.bytes) }));
  onProgress(0);
  const result = await renderPatched(request.schedule, request.patches, packs, { onProgress, ...(request.volume === undefined ? {} : { volume: request.volume }) });
  return { wav: toWav(result) };
}

/** WAV 저장 (Web Worker) */
export function wavJob(makeWorker = workerMaker(() => new Worker(new URL("./wav.worker.ts", import.meta.url), { type: "module" }))) {
  return new WorkerJob<WavRequest, WavResult>(makeWorker, renderWavFile);
}

/** 브라우저 안 받아 적기 (Web Worker, 실험실). 워커가 실패하면 화면 쪽에서 돈다 */
export function pitchJob(makeWorker = workerMaker(() => new Worker(new URL("./pitch.worker.ts", import.meta.url), { type: "module" }))) {
  return new WorkerJob<PitchRequest, TimedNote[]>(makeWorker, transcribePitch);
}

function workerMaker(make: () => Worker): (() => Worker) | undefined {
  return typeof Worker === "undefined" ? undefined : make;
}
