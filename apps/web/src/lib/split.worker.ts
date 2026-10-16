/// <reference lib="webworker" />
import { splitSong } from "@mmlce/mml";
import type { SplitRequest } from "./jobs";
import { serveJob, type WorkerScope } from "./workerJob";

/** 악보책 나누기를 화면과 따로 계산한다 (긴 곡도 화면이 멈추지 않게). 권 하나를 정할 때마다 진행률을 보낸다 */
serveJob(self as unknown as WorkerScope, ({ song, profile }: SplitRequest, onProgress) => splitSong(song, profile, { onProgress }));
