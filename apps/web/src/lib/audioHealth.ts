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

/** 아이패드·아이폰에서 이만큼(ms) 넘게 가려져 있었으면 화면을 잠갔다 연 것으로 본다 */
export const LOCK_HIDDEN_MS = 3000;
/** 출력 지연이 이만큼(초) 넘게 늘었으면 오디오 출력이 바뀐 것으로 본다 */
export const LATENCY_JUMP = 0.05;

/** 아이패드·아이폰(터치 WebKit)인지. 아이패드는 데스크톱 사파리처럼 Macintosh로 자신을 알린다 */
export function isTouchWebKit(ua: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/**
 * 화면을 가렸다 돌아온 뒤, 시계가 흐르더라도 오디오를 새로 만들어야 하는지.
 * 아이패드는 화면을 잠갔다 열면 오디오를 "중단됨"으로 두었다가, 화면을 누를 때 다시 켜지기는 하지만
 * 그 뒤로 소리가 재생선·건반보다 늦게 나온다(밀림). 앱을 완전히 껐다 켜면 괜찮아지므로, 오디오를 새로 만들어 같은 효과를 낸다.
 * - 한 번도 소리를 내지 않았으면(warmed 아님) 새로 만들 것이 없다
 * - 가려진 사이 시스템이 오디오를 멈췄으면(interrupted) 새로 만든다. 다시 켜졌어도 출력이 어긋나 있을 수 있다
 * - 아이패드·아이폰에서 LOCK_HIDDEN_MS 넘게 가려져 있었으면(화면 잠금) 상태가 그대로여도 새로 만든다
 * - 브라우저가 알려 주는 출력 지연이 LATENCY_JUMP 넘게 늘었으면 새로 만든다
 * PC에서 다른 탭을 잠깐 본 것만으로는 새로 만들지 않는다 (사운드팩을 다시 올리느라 첫 재생이 늦어지므로)
 */
export function staleAfterReturn(o: {
  warmed: boolean;
  interrupted: boolean;
  hiddenMs: number;
  touchWebKit: boolean;
  latencyBefore: number;
  latencyNow: number;
}): boolean {
  if (!o.warmed) return false;
  if (o.interrupted) return true;
  if (o.touchWebKit && o.hiddenMs >= LOCK_HIDDEN_MS) return true;
  return o.latencyNow - o.latencyBefore > LATENCY_JUMP;
}
