/**
 * 진단 정보: 문제를 신고할 때 붙여 넣을 판·빌드·브라우저·켠 실험실·최근 오류.
 * 최근 오류는 화면 보기가 깨졌거나(오류 경계) 아무도 받지 않은 예외(전역 처리)·워커 계산 실패를 적어 둔다.
 * 곡 내용은 담지 않는다. 페이지를 새로 열면 비어 있다
 */

/** 적어 둔 오류 하나 */
export interface RecentError {
  /** 처음 난 때 (ms) */
  readonly at: number;
  /** 어디서: "window", "promise", "view:roll", "wav" 같은 짧은 이름 */
  readonly where: string;
  readonly message: string;
  /** 호출 위치 몇 줄 (있으면) */
  readonly stack?: string;
  /** 같은 오류가 잇달아 난 횟수 */
  readonly count: number;
}

/** 오류를 한 줄 글로: Error면 "이름: 내용", 아니면 글로 바꾼 값 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}

/** 호출 위치는 앞 몇 줄만 (길면 신고 칸을 덮는다) */
const STACK_LINES = 6;

function stackOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  return error.stack.split("\n").slice(0, STACK_LINES).join("\n");
}

/**
 * 브라우저가 스스로 내는 무해한 알림이라 적지도 않는 오류.
 * ResizeObserver 알림은 크기 조정이 한 프레임 늦었다는 뜻일 뿐이다
 */
export function harmlessError(message: string): boolean {
  return /ResizeObserver loop/i.test(message);
}

/**
 * 적어 두기만 하고 사용자에게 알리지는 않는 오류: 멈추게 한 동작(AbortError)·브라우저가 막은 재생(NotAllowedError),
 * 다른 출처 스크립트라 내용을 모르는 오류("Script error.")
 */
export function quietError(error: unknown, message: string): boolean {
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : "";
  return name === "AbortError" || name === "NotAllowedError" || /^Script error\.?$/.test(message);
}

/** 최근 오류를 몇 개까지 적어 둔다 */
export const RECENT_ERRORS = 10;

/** 최근 오류 목록. 같은 곳에서 같은 오류가 잇달아 나면 횟수만 늘린다 */
export class ErrorLog {
  private items: RecentError[] = [];

  constructor(private readonly max = RECENT_ERRORS) {}

  /** 오류를 적고 적은 항목을 돌려준다 */
  note(where: string, error: unknown, now = Date.now()): RecentError {
    const message = errorText(error);
    const last = this.items.at(-1);
    if (last && last.where === where && last.message === message) {
      const next = { ...last, count: last.count + 1 };
      this.items[this.items.length - 1] = next;
      return next;
    }
    const stack = stackOf(error);
    const item: RecentError = { at: now, where, message, ...(stack ? { stack } : {}), count: 1 };
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    return item;
  }

  list(): readonly RecentError[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}

/** 이 페이지의 최근 오류 */
export const errorLog = new ErrorLog();

/** 진단 정보에 담는 것 */
export interface DiagnosticInfo {
  readonly version: string;
  readonly build: string;
  readonly commit: string;
  /** 브라우저가 알려 주는 이름 (navigator.userAgent) */
  readonly userAgent: string;
  /** 화면 언어 */
  readonly locale: string;
  /** 앱으로 설치해 열었는지 등 화면 정보 한 줄 */
  readonly display: string;
  /** 켠 실험실 (끔이면 빈 목록) */
  readonly labs: readonly string[];
  readonly errors: readonly RecentError[];
}

/** 신고에 붙여 넣을 글. 개발자가 읽으므로 항목 이름은 짧은 영어로 둔다 */
export function diagnosticText(info: DiagnosticInfo): string {
  const lines = [
    `BiNote ${info.version}`,
    `build: ${info.build || "-"} · commit: ${info.commit || "-"}`,
    `browser: ${info.userAgent || "-"}`,
    `locale: ${info.locale}`,
    `display: ${info.display || "-"}`,
    `labs: ${info.labs.length > 0 ? info.labs.join(", ") : "off"}`,
  ];
  if (info.errors.length === 0) {
    lines.push("recent errors: none");
  } else {
    lines.push(`recent errors (${info.errors.length}):`);
    for (const e of info.errors) {
      const times = e.count > 1 ? ` ×${e.count}` : "";
      lines.push(`- ${new Date(e.at).toISOString()} [${e.where}]${times} ${e.message}`);
      if (e.stack) for (const line of e.stack.split("\n").slice(1)) lines.push(`    ${line.trim()}`);
    }
  }
  return lines.join("\n");
}

/** 실험실 상태를 목록으로: 끔이면 빈 목록, 켰으면 "on"과 켠 세부 설정 */
export function enabledLabs(labs: { readonly on: boolean; readonly buttonNames: boolean; readonly fade: boolean }, extra: readonly string[] = []): string[] {
  if (!labs.on) return [];
  return ["on", ...(labs.buttonNames ? ["buttonNames"] : []), ...(labs.fade ? ["fade"] : []), ...extra];
}

/** 지금 화면 정보 한 줄: 화면 크기·배율·터치·앱 설치 여부 */
export function displayInfo(): string {
  if (typeof window === "undefined") return "";
  const parts = [`${window.innerWidth}×${window.innerHeight}@${window.devicePixelRatio || 1}x`];
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) parts.push(`touch ${navigator.maxTouchPoints}`);
  if (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches) parts.push("standalone");
  return parts.join(" · ");
}

/** 전역 오류를 받는 곳 (window. 시험에서는 가짜) */
export interface ErrorTarget {
  addEventListener(type: "error" | "unhandledrejection", listener: (event: Event) => void): void;
  removeEventListener(type: "error" | "unhandledrejection", listener: (event: Event) => void): void;
}

/**
 * 아무도 받지 않은 예외(window error)와 거부된 약속(unhandledrejection)을 최근 오류에 적고, 알릴 만한 오류면 oncrash를 부른다.
 * 브라우저 기본 처리(콘솔에 쓰기)는 그대로 둔다. 돌려준 함수로 그만 듣는다
 */
export function watchUncaught(target: ErrorTarget, oncrash: (item: RecentError) => void, log: ErrorLog = errorLog): () => void {
  const take = (where: string, error: unknown) => {
    const message = errorText(error);
    if (harmlessError(message)) return;
    const item = log.note(where, error);
    if (!quietError(error, message)) oncrash(item);
  };
  const onerror = (event: Event) => {
    const e = event as ErrorEvent;
    take("window", e.error ?? e.message);
  };
  const onrejection = (event: Event) => take("promise", (event as PromiseRejectionEvent).reason);
  target.addEventListener("error", onerror);
  target.addEventListener("unhandledrejection", onrejection);
  return () => {
    target.removeEventListener("error", onerror);
    target.removeEventListener("unhandledrejection", onrejection);
  };
}
