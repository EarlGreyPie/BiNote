/**
 * 오디오가 잠자기에서 깨어난 뒤 살아 있는지 판단하는 작은 도구들.
 * 기기를 재웠다 깨우면(전원 버튼) 아이패드는 오디오를 "interrupted"로 두고, resume()이 끝나지 않거나
 * 끝나도 시계가 멈춰 있을 때가 있다. 그러면 그 오디오는 버리고 새로 만들어야 소리가 난다.
 */

/** 브라우저가 알려 주는 오디오 상태 (WebKit은 표준에 없는 "interrupted"도 쓴다) */
export type AudioState = AudioContextState | "interrupted" | string;

/** 약속이 ms 안에 끝나면 true, 오류로 끝나거나 시간이 지나면 false. 끝나지 않는 resume()에 붙잡히지 않으려고 쓴다 */
export async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 시계(read)가 ms 안에 앞으로 가는지 본다 */
export async function clockMoves(read: () => number, ms: number, wait: (ms: number) => Promise<void> = sleep): Promise<boolean> {
  const t0 = read();
  const until = performance.now() + ms;
  while (performance.now() < until) {
    await wait(15);
    if (read() > t0) return true;
  }
  return read() > t0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 오디오를 새로 만들어야 하는지.
 * - 닫혔거나 워크릿이 오류로 멈췄으면(broken) 언제나
 * - 깨워 보았는데(resume) 시계가 그대로면: 잠자기 뒤처럼 의심스러울 때만. 처음 켤 때(사용자가 아직 누르지 않아
 *   suspended)는 정상이라 새로 만들지 않는다
 */
export function needsRebuild(o: { state: AudioState; broken: boolean; suspect: boolean; clockMoved: boolean }): boolean {
  if (o.broken || o.state === "closed") return true;
  return o.suspect && !o.clockMoved;
}
