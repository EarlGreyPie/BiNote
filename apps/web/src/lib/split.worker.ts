/// <reference lib="webworker" />
import { planSplit } from "./splitPlan";
import { serveJob, type WorkerScope } from "./workerJob";

/** 악보책 나누기를 화면과 따로 계산한다 (긴 곡도 화면이 멈추지 않게). 단계와 진행률을 보낸다 */
serveJob(self as unknown as WorkerScope, planSplit);
