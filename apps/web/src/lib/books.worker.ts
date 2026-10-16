/// <reference lib="webworker" />
import { fewerBooks } from "@mmlce/mml";
import type { BooksRequest } from "./jobs";
import { serveJob, type WorkerScope } from "./workerJob";

/** 악보책 권 수를 줄일 수 있는지 화면과 따로 계산한다 (곡을 몇 번 나눠 봐야 해서 오래 걸린다) */
serveJob(self as unknown as WorkerScope, ({ song, profile, books }: BooksRequest) => fewerBooks(song, profile, books));
