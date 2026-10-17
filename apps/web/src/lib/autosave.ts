/**
 * 자동 보존이 무엇을 이미 적었는지 기억한다. 저장이 성공한 상태만 "적었다"로 친다.
 * 실패한 저장은 적지 않은 것으로 남아 다음 기회(창 숨김·다음 편집)에 다시 적는다.
 * 늦게 온 응답은 요청할 때의 작업과 순서를 보고, 다른 작업이거나 더 나중 저장이 이미 끝났으면 무시한다.
 * 다른 상태를 적는 중이면 그 저장이 끝나면 기록이 그 상태가 되므로, 지금 상태를 뒤이어 다시 적어야 한다.
 * (저장 자체는 부르는 쪽이 보낸 순서대로 끝나게 줄을 세운다)
 */
export class AutosaveTracker<T> {
  /** 이 작업으로 마지막에 적은 상태 (아직 안 적었으면 연 그대로) */
  private saved: T | undefined;
  /** 지금 적고 있는 상태. 같은 상태를 두 번 보내지 않는다 */
  private saving: T | undefined;
  /** 지금 적고 있는 상태를 보낸 순서. 값이 같아도 앞 저장의 응답이 뒤 저장을 지우지 않게 순서로 가린다 */
  private savingSeq = 0;
  private work = 0;
  private seq = 0;
  private savedSeq = 0;

  /** same: 두 상태가 같은지 (기본은 같은 객체). 곡과 편집 상태처럼 묶은 상태를 값으로 비교할 때 준다 */
  constructor(readonly same: (a: T, b: T) => boolean = (a, b) => a === b) {}

  /** 새 작업을 시작한다. opened는 연 그대로의 상태 (안 고쳤으면 적지 않는다) */
  reset(opened: T | undefined): void {
    this.work++;
    this.saved = opened;
    this.saving = undefined;
    this.savedSeq = this.seq;
  }

  /** 적는 중인 저장이 있나 (있으면 마지막으로 보낸 저장이다) */
  get pending(): boolean {
    return this.saving !== undefined;
  }

  /** 적을 것이 있나. 적는 중인 상태가 있으면 그것과 비교한다 (그 저장이 끝나면 기록이 그것이 된다) */
  dirty(current: T | undefined): current is T {
    if (current === undefined) return false;
    const base = this.saving !== undefined ? this.saving : this.saved;
    return base === undefined || !this.same(current, base);
  }

  /** 저장을 시작한다. 돌려받은 함수를 저장 결과(성공 여부)와 함께 부른다 */
  begin(current: T): (ok: boolean) => void {
    const work = this.work;
    const seq = ++this.seq;
    this.saving = current;
    this.savingSeq = seq;
    return (ok) => {
      if (work !== this.work) return;
      if (seq === this.savingSeq) this.saving = undefined;
      if (ok && seq > this.savedSeq) {
        this.savedSeq = seq;
        this.saved = current;
      }
    };
  }
}

/**
 * 자동 보존 저장을 보낸 순서대로 이어서 하고, 지금 상태가 실제로 적혔는지 기다릴 수 있게 한다.
 * 저장은 실패를 예외 대신 false로 알리므로, flush는 false를 거부로 바꿔 돌려준다
 * (업데이트 새로고침처럼 "적혔을 때만" 해야 하는 일이 실패를 성공으로 오해하지 않게)
 */
export class AutosaveQueue<T> {
  private queue: Promise<unknown> = Promise.resolve();
  /** 마지막으로 보낸 저장과 그 상태 */
  private last: { state: T; job: Promise<void> } | undefined;

  constructor(private readonly tracker: AutosaveTracker<T>) {}

  /**
   * current를 적는다. prepare는 바로 불러 적을 내용을 만들고, 돌려준 함수는 앞 저장이 끝난 뒤 부른다.
   * 적을 것이 없으면(이미 적었거나 적는 중) 그 상태를 적는 저장을 기다린다. 적지 못하면 거부된다
   */
  flush(current: T | undefined, prepare: (state: T) => () => Promise<boolean>): Promise<void> {
    if (!this.tracker.dirty(current)) {
      // 적는 중인 상태면 그 저장(마지막으로 보낸 저장)의 결과를 따른다. 이미 적은 상태면 할 일이 없다
      return current !== undefined && this.tracker.pending && this.last ? this.last.job : Promise.resolve();
    }
    const save = prepare(current);
    const done = this.tracker.begin(current);
    const job = this.queue.then(save).then((ok) => {
      done(ok);
      if (!ok) throw new Error("autosave failed");
    });
    // 한 번 실패해도 다음 저장은 이어서 한다
    this.queue = job.catch(() => {});
    this.last = { state: current, job };
    return job;
  }
}
