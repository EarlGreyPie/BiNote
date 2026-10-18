/**
 * 건반 미리듣기에서 누른 건반 높이 → 음역에 맞춰 접어 신스로 보낸 높이. 뗄 때 보낸 높이로 끈다.
 * 여러 건반이 같은 높이로 접혀 울릴 수 있어, 그 높이로 울리는 건반이 남아 있으면 끄지 않는다
 */
export class PreviewVoices {
  private sent = new Map<number, number>();

  /**
   * pitch를 sent 높이로 낸다고 적고, 켜기 전에 끌 높이를 돌려준다. 같은 건반을 떼지 않고 다시 누르면
   * (트랙을 바꿔 다른 악기로 누르는 등) 앞에 보낸 높이를 먼저 끈다. 덮어쓰면 그 음이 꺼지지 않는다
   */
  press(pitch: number, sent: number): number[] {
    const off = this.sent.has(pitch) ? this.release(pitch) : [];
    this.sent.set(pitch, sent);
    return off;
  }

  /** 건반을 뗄 때 끌 높이. 적어 둔 것이 없으면 누른 높이 그대로 (전과 같이) */
  release(pitch: number): number[] {
    const sent = this.sent.get(pitch) ?? pitch;
    this.sent.delete(pitch);
    return [...this.sent.values()].includes(sent) ? [] : [sent];
  }
}
