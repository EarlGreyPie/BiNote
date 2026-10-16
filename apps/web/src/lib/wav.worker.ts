/// <reference lib="webworker" />
import { renderWavFile, type WavRequest, type WavResult } from "./jobs";
import { serveJob, type WorkerScope } from "./workerJob";

/** WAV 그리기를 화면과 따로 한다 (사운드팩으로 곡 전체를 그리므로 오래 걸린다) */
serveJob(self as unknown as WorkerScope, renderWavFile, (result: WavResult) => [result.wav]);
