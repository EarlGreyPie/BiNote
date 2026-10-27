/// <reference lib="webworker" />
import { transcribePitch } from "./pitchTranscribe";
import { serveJob, type WorkerScope } from "./workerJob";

/** 브라우저 안 받아 적기를 화면과 따로 한다 (모델 계산이 수십 초 걸린다) */
serveJob(self as unknown as WorkerScope, transcribePitch);
