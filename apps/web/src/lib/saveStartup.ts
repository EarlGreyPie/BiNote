/** ask: 저장할 때마다 저장 창에서 고른다, folder: 정해 둔 폴더에 바로 쓴다, download: 다운로드 폴더 */
export type SaveMode = "ask" | "folder" | "download";

/**
 * 시작할 때 예전에 정해 둔 폴더를 읽는 일과, 저장 방식 고르기·저장 사이의 순서를 맞춘다.
 * - 저장 방식 기록이 없는 사람(저장 창이 생기기 전에 폴더를 정해 둔 사람)은 폴더를 찾으면 folder로 바꾼다.
 *   읽는 사이 사용자가 방식을 골랐으면 그 선택을 덮지 않는다.
 * - 저장은 읽기가 끝나기를 잠깐 기다린 뒤 방식을 고른다 (읽기 전에 기본값 ask로 저장 창이 한 번 뜨지 않게)
 */
export class SaveStartup {
  private chosen = false;
  private loading: Promise<void> | undefined;
  private settled = false;

  /** target.mode를 고친다 (화면이 따르는 상태). storedMode: 기억해 둔 저장 방식 (없으면 undefined) */
  constructor(
    private readonly target: { mode: SaveMode },
    private readonly storedMode: SaveMode | undefined,
  ) {}

  /** 사용자가 저장 방식을 골랐다 */
  choose(mode: SaveMode): void {
    this.chosen = true;
    this.target.mode = mode;
  }

  /** 예전 폴더를 읽는다 (한 번만). read는 폴더가 있으면 true. 읽지 못하면 그대로 둔다 */
  load(read: () => Promise<boolean>): Promise<void> {
    this.loading ??= (async () => {
      try {
        if ((await read()) && this.storedMode === undefined && !this.chosen) this.target.mode = "folder";
      } catch {
        // 저장소를 못 쓰면 지금 방식 그대로
      } finally {
        this.settled = true;
      }
    })();
    return this.loading;
  }

  /**
   * 저장하기 전에 부른다. 읽기가 끝나기를 waitMs까지 기다린다.
   * 그래도 끝나지 않았고 예전 폴더 때문에 방식이 바뀔 수 있으면 false (저장 창을 띄우지 말고 다시 저장하라고 알린다).
   * 저장 창은 누른 직후(브라우저가 사용자 동작으로 보는 몇 초)에만 뜨므로 오래 기다리지 않는다
   */
  async ready(waitMs: number): Promise<boolean> {
    if (!this.loading || this.settled) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      this.loading.then(() => true),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), waitMs))),
    ]);
    clearTimeout(timer);
    return finished || this.storedMode !== undefined || this.chosen;
  }
}
