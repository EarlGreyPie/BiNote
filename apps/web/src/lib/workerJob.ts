/** 워커에 보내는 요청 (번호 + 내용) */
export interface JobRequest<Req> {
  readonly id: number;
  readonly request: Req;
}

/** 워커가 보내는 답: 진행률, 결과, 오류 */
export type JobReply<Res> =
  | { readonly id: number; readonly progress: number }
  | { readonly id: number; readonly result: Res }
  | { readonly id: number; readonly error: string };

/**
 * 무거운 계산을 Web Worker에서 돌린다. 한 번에 하나만: 새로 시작하거나 취소하면 돌던 계산은 멈추고
 * (워커를 끝내고 다음에 새로 만든다) 그 결과는 undefined로 끝난다. 요청마다 번호를 붙여 늦게 온 답은 버린다.
 * 워커를 못 쓰는 곳(시험 환경 등)이나 워커가 실패하면 화면 쪽에서 local로 계산한다.
 * local은 진행률을 자주 알려야 한다: 취소된 뒤에는 그 콜백이 예외를 던져 계산을 멈춘다
 */
export class WorkerJob<Req, Res> {
  private worker: Worker | undefined;
  private seq = 0;
  private pending: { id: number; done: (result: Res | undefined) => void } | undefined;

  constructor(
    private readonly makeWorker: (() => Worker) | undefined,
    private readonly local: (request: Req, onProgress: (fraction: number) => void) => Res | Promise<Res>,
  ) {}

  /** 지금 계산 중인지 */
  get busy(): boolean {
    return this.pending !== undefined;
  }

  run(request: Req, onProgress: (fraction: number) => void = () => {}): Promise<Res | undefined> {
    this.cancel();
    const id = ++this.seq;
    return new Promise((resolve) => {
      const done = (result: Res | undefined) => {
        if (this.pending?.id !== id) return;
        this.pending = undefined;
        resolve(result);
      };
      this.pending = { id, done };
      // 화면 쪽 계산의 진행률도 지금 요청일 때만 알린다. 취소된 계산은 다음 진행률 보고에서 멈춘다
      const localProgress = (fraction: number) => {
        if (this.pending?.id !== id) throw new JobCancelled();
        onProgress(fraction);
      };
      const local = async () => {
        if (this.pending?.id !== id) return;
        try {
          done(await this.local(request, localProgress));
        } catch {
          done(undefined);
        }
      };
      const worker = this.ensureWorker();
      if (!worker) {
        // 화면에 진행 표시를 먼저 그린 뒤 시작한다
        setTimeout(local, 30);
        return;
      }
      worker.onmessage = (event: MessageEvent<JobReply<Res>>) => {
        const reply = event.data;
        if (reply.id !== id || this.pending?.id !== id) return;
        if ("progress" in reply) onProgress(reply.progress);
        else if ("result" in reply) done(reply.result);
        else this.fallBack(local);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (this.pending?.id === id) this.fallBack(local);
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

  private ensureWorker(): Worker | undefined {
    if (this.worker || !this.makeWorker) return this.worker;
    try {
      this.worker = this.makeWorker();
    } catch {
      this.worker = undefined;
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
export function serveJob<Req, Res>(
  scope: WorkerScope,
  work: (request: Req, onProgress: (fraction: number) => void) => Res | Promise<Res>,
  transfer: (result: Res) => Transferable[] = () => [],
): void {
  scope.onmessage = async (event: MessageEvent<JobRequest<Req>>) => {
    const { id, request } = event.data;
    try {
      const result = await work(request, (progress) => scope.postMessage({ id, progress } satisfies JobReply<Res>));
      scope.postMessage({ id, result } satisfies JobReply<Res>, transfer(result));
    } catch (e) {
      scope.postMessage({ id, error: String(e) } satisfies JobReply<Res>);
    }
  };
}
