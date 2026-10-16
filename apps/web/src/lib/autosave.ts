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
  private work = 0;
  private seq = 0;
  private savedSeq = 0;

  /** 새 작업을 시작한다. opened는 연 그대로의 상태 (안 고쳤으면 적지 않는다) */
  reset(opened: T | undefined): void {
    this.work++;
    this.saved = opened;
    this.saving = undefined;
    this.savedSeq = this.seq;
  }

  /** 적을 것이 있나. 적는 중인 상태가 있으면 그것과 비교한다 (그 저장이 끝나면 기록이 그것이 된다) */
  dirty(current: T | undefined): current is T {
    if (current === undefined) return false;
    return this.saving !== undefined ? current !== this.saving : current !== this.saved;
  }

  /** 저장을 시작한다. 돌려받은 함수를 저장 결과(성공 여부)와 함께 부른다 */
  begin(current: T): (ok: boolean) => void {
    const work = this.work;
    const seq = ++this.seq;
    this.saving = current;
    return (ok) => {
      if (work !== this.work) return;
      if (this.saving === current) this.saving = undefined;
      if (ok && seq > this.savedSeq) {
        this.savedSeq = seq;
        this.saved = current;
      }
    };
  }
}
