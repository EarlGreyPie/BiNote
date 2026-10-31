/**
 * 탭 사이 작업 잠금: 같은 자동 보존 작업(workId)을 두 탭이 함께 이어 쓰지 않게 한다.
 * 브라우저의 Web Locks(navigator.locks)를 쓴다. 탭을 닫거나 새로고침하면 브라우저가 잠금을 저절로 푼다.
 * 잠금을 못 쓰는 브라우저(옛 사파리 등)에서는 막지 않는다 (예전처럼 동작한다).
 */

/** 잠금 이름 앞에 붙인다. 사이트 안에서만 보이는 이름이다 */
const PREFIX = "mmlce-work:";

/** 쓰는 것만 떼어 낸 LockManager (시험에서 가짜로 바꿔 끼운다) */
export type WorkLockManager = Pick<LockManager, "request" | "query">;

export class WorkLocks {
  /** 이 탭이 쥐고 있는 잠금과 푸는 함수 */
  private readonly held = new Map<string, () => void>();
  /** 마지막으로 맡겠다고 한 작업. 늦게 잡힌 앞 잠금은 바로 푼다 */
  private want: string | undefined;
  /** 아직 답이 오지 않은 이 탭의 잠금 요청. 같은 작업을 또 맡으려 하면 그 요청을 같이 기다린다 */
  private readonly asking = new Map<string, Promise<boolean>>();

  constructor(private readonly locks: WorkLockManager | undefined = globalThis.navigator?.locks) {}

  /**
   * 이 탭이 id 작업을 맡는다. 맡으면 전에 맡던 작업은 놓는다.
   * 다른 탭이 이미 맡고 있으면 false (이때 전에 맡던 작업은 그대로 쥔다). 잠금을 못 쓰면 언제나 true
   */
  claim(id: string): Promise<boolean> {
    this.want = id;
    if (this.held.has(id)) {
      this.keepOnly(id);
      return Promise.resolve(true);
    }
    const locks = this.locks;
    if (!locks) return Promise.resolve(true);
    // 같은 작업을 잇달아 맡으면(되살리기를 두 번 누르는 등) 새로 요청하지 않는다.
    // 새로 요청하면 앞 요청이 잡은 이 탭의 잠금에 막혀 다른 탭 작업으로 잘못 본다
    const asking = this.asking.get(id);
    if (asking) return asking;
    const job = new Promise<boolean>((resolve) => {
      locks
        .request(PREFIX + id, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          // 이 약속이 풀릴 때까지 잠금을 쥔다
          return new Promise<void>((release) => {
            this.held.set(id, release);
            // 잡는 사이 다른 작업을 맡겠다고 했으면 바로 놓는다
            if (this.want === id) this.keepOnly(id);
            else this.drop(id);
            resolve(true);
          });
        })
        // 잠금 자체가 고장 나면 막지 않는다
        .catch(() => resolve(true));
    });
    this.asking.set(id, job);
    void job.then(() => this.asking.delete(id));
    return job;
  }

  /** 다른 탭이 맡고 있는 작업 id들. 잠금을 못 쓰면 빈 집합 */
  async heldElsewhere(): Promise<ReadonlySet<string>> {
    try {
      const snapshot = await this.locks?.query();
      const out = new Set<string>();
      for (const l of snapshot?.held ?? []) {
        const id = l.name?.startsWith(PREFIX) ? l.name.slice(PREFIX.length) : undefined;
        if (id && !this.held.has(id)) out.add(id);
      }
      return out;
    } catch {
      return new Set();
    }
  }

  private keepOnly(id: string): void {
    for (const other of [...this.held.keys()]) if (other !== id) this.drop(other);
  }

  private drop(id: string): void {
    this.held.get(id)?.();
    this.held.delete(id);
  }
}
