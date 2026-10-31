import { errorLog, errorText, type ErrorLog } from "./diagnostics";

/** 워커에 보내는 요청 (번호 + 내용) */
export interface JobRequest<Req> {
  readonly id: number;
  readonly request: Req;
}

/** 워커가 보내는 답: 진행률(보통 0~1 숫자, 단계가 있으면 단계와 함께), 결과, 오류 */
export type JobReply<Res, P = number> =
  | { readonly id: number; readonly progress: P }
  | { readonly id: number; readonly result: Res }
  | { readonly id: number; readonly error: string };

/**
 * 무거운 계산을 Web Worker에서 돌린다. 한 번에 하나만: 새로 시작하거나 취소하면 돌던 계산은 멈추고
 * (워커를 끝내고 다음에 새로 만든다) 그 결과는 undefined로 끝난다. 요청마다 번호를 붙여 늦게 온 답은 버린다.
 * 워커를 못 쓰는 곳(시험 환경 등)이나 워커가 실패하면 화면 쪽에서 local로 계산한다.
 * local은 진행률을 자주 알려야 한다: 취소된 뒤에는 그 콜백이 예외를 던져 계산을 멈춘다.
 * 실패해 undefined로 끝나면 그 까닭을 lastError에 남긴다 (워커가 알린 오류와 화면 쪽 오류를 함께).
 * 워커가 실패한 일 자체도 최근 오류(진단 정보)에 "worker:이름"으로 적는다. 화면 쪽 계산이 대신 해내도 남아서,
 * 어느 기기에서 워커가 안 돌아 무거운 계산이 화면 쪽으로 넘어왔는지 신고로 알 수 있다
 */
export class WorkerJob<Req, Res, P = number> {
  private worker: Worker | undefined;
  private seq = 0;
  private pending: { id: number; done: (result: Res | undefined) => void } | undefined;
  private failure: string | undefined;

  constructor(
    private readonly makeWorker: (() => Worker) | undefined,
    private readonly local: (request: Req, onProgress: (progress: P) => void) => Res | Promise<Res>,
    /** 최근 오류에 적을 이름 ("split", "wav" 같은)과 적을 곳 (시험에서는 따로) */
    private readonly report: { readonly name: string; readonly log: Pick<ErrorLog, "note"> } = { name: "job", log: errorLog },
  ) {}

  /** 지금 계산 중인지 */
  get busy(): boolean {
    return this.pending !== undefined;
  }

  /** 마지막 계산이 실패했으면 그 까닭 (취소는 실패가 아니다). 새로 시작하면 지운다 */
  get lastError(): string | undefined {
    return this.failure;
  }

  run(request: Req, onProgress: (progress: P) => void = () => {}): Promise<Res | undefined> {
    this.cancel();
    this.failure = undefined;
    const id = ++this.seq;
    /** 워커가 알린 오류 (화면 쪽으로 다시 계산해도 실패하면 함께 남긴다) */
    let workerError: string | undefined;
    return new Promise((resolve) => {
      const done = (result: Res | undefined, failure?: string) => {
        if (this.pending?.id !== id) return;
        this.pending = undefined;
        this.failure = failure;
        resolve(result);
      };
      this.pending = { id, done };
      // 화면 쪽 계산의 진행률도 지금 요청일 때만 알린다. 취소된 계산은 다음 진행률 보고에서 멈춘다
      const localProgress = (progress: P) => {
        if (this.pending?.id !== id) throw new JobCancelled();
        onProgress(progress);
      };
      const local = async () => {
        if (this.pending?.id !== id) return;
        try {
          done(await this.local(request, localProgress));
        } catch (e) {
          // 취소로 멈춘 것은 실패가 아니다 (그때는 이미 다른 요청이거나 끝난 뒤라 done이 무시된다)
          if (e instanceof JobCancelled) return done(undefined);
          const local = errorText(e);
          done(undefined, workerError && workerError !== local ? `${workerError} / ${local}` : local);
        }
      };
      const worker = this.ensureWorker();
      if (!worker) {
        // 화면에 진행 표시를 먼저 그린 뒤 시작한다
        setTimeout(local, 30);
        return;
      }
      worker.onmessage = (event: MessageEvent<JobReply<Res, P>>) => {
        const reply = event.data;
        if (reply.id !== id || this.pending?.id !== id) return;
        if ("progress" in reply) onProgress(reply.progress);
        else if ("result" in reply) done(reply.result);
        else {
          workerError = `worker: ${reply.error}`;
          this.report.log.note(`worker:${this.report.name}`, reply.error);
          this.fallBack(local);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (this.pending?.id !== id) return;
        // 워커 파일을 못 읽었을 때도 온다 (그때는 message가 비어 있기도 하다)
        const reason = event.message || "failed to start";
        workerError = `worker: ${reason}`;
        this.report.log.note(`worker:${this.report.name}`, reason);
        this.fallBack(local);
      };
      worker.postMessage({ id, request } satisfies JobRequest<Req>);
    });
  }

  /** 돌던 계산을 멈춘다. 그 계산은 undefined로 끝난다 */
  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.worker?.terminate();
    this.worker = undefined;
    pending.done(undefined);
  }

  /** 다 썼다: 돌던 계산을 멈추고 쉬고 있는 워커도 끝낸다 (창을 닫을 때). 다시 run하면 새 워커를 만든다 */
  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): Worker | undefined {
    if (this.worker || !this.makeWorker) return this.worker;
    try {
      this.worker = this.makeWorker();
    } catch (e) {
      // 워커를 만들지 못했다 (모듈 워커를 못 쓰는 브라우저 등): 화면 쪽에서 계산하고 까닭은 최근 오류에 남긴다
      this.worker = undefined;
      this.report.log.note(`worker:${this.report.name}`, e);
    }
    return this.worker;
  }

  /** 워커가 실패했다: 그 워커는 버리고 화면 쪽에서 계산한다 */
  private fallBack(local: () => void) {
    this.worker?.terminate();
    this.worker = undefined;
    setTimeout(local, 0);
  }
}

/** 취소된 화면 쪽 계산을 멈추려고 진행률 콜백이 던진다 */
class JobCancelled extends Error {}

/** 워커 전역 (화면 쪽 타입으로는 self가 Window라 따로 적는다) */
export interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/** 워커 안에서: 요청을 받아 계산하고 진행률·결과를 보낸다 */
export function serveJob<Req, Res, P = number>(
  scope: WorkerScope,
  work: (request: Req, onProgress: (progress: P) => void) => Res | Promise<Res>,
  transfer: (result: Res) => Transferable[] = () => [],
): void {
  scope.onmessage = async (event: MessageEvent<JobRequest<Req>>) => {
    const { id, request } = event.data;
    try {
      const result = await work(request, (progress) => scope.postMessage({ id, progress } satisfies JobReply<Res, P>));
      scope.postMessage({ id, result } satisfies JobReply<Res>, transfer(result));
    } catch (e) {
      scope.postMessage({ id, error: errorText(e) } satisfies JobReply<Res>);
    }
  };
}
