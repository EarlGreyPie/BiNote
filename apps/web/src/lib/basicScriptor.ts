/**
 * Basic Scriptor 연결: PC에서 따로 켜 둔 Basic Scriptor(음원 → MIDI 받아 적기 프로그램)의 로컬 서버와 주고받는다.
 * 규격은 dev docs/BASIC_SCRIPTOR_API.md. BiNote는 음원을 보내고 MIDI를 받아 MIDI 불러오기 창으로 넘긴다.
 * - 서버는 이 컴퓨터(127.0.0.1)에만 있다. 아이패드·휴대폰은 PC의 서버에 닿을 수 없어서 PC에서만 쓴다
 * - 짝 맞추기: Basic Scriptor 창에 뜬 짝 번호를 넣으면 토큰을 받는다. 토큰은 메모리에만 두어 BiNote를 다시 켜면 다시 맞춘다
 */

export const BASIC_SCRIPTOR_API = 1;
export const DEFAULT_BASIC_SCRIPTOR_PORT = 47811;
const PORT_KEY = "mmlce.basicScriptor.port";

/** 받아 적기 엔진 하나 (MuScriptor, basic-pitch 등). ready: 모델을 받아 두어 바로 쓸 수 있는지 */
export interface ScriptorEngine {
  readonly id: string;
  readonly label: string;
  readonly ready: boolean;
}

export interface ScriptorHealth {
  readonly version: string;
  readonly engines: readonly ScriptorEngine[];
  /** 세기 다듬기 방법 (sfproxy 등). 없으면 받아 적은 세기 그대로 */
  readonly velocity: readonly string[];
}

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface ScriptorJob {
  readonly state: JobState;
  /** 0~1 */
  readonly progress: number;
  /** 지금 단계 이름 (받아 적기, 세기 다듬기 등). 서버가 주는 글 그대로 */
  readonly stage: string;
  readonly message: string;
}

export interface ScriptorOptions {
  readonly engine: string;
  /** 세기 다듬기 방법. "none"이면 하지 않는다 */
  readonly velocity: string;
  /** 음원 악기 힌트 (세기 다듬기 모델 고르기): auto · piano · guitar */
  readonly instrument: "auto" | "piano" | "guitar";
}

/** 서버가 토큰을 받지 않음 (Basic Scriptor를 다시 켰거나 짝이 풀림): 짝 번호를 다시 넣는다 */
export class ScriptorAuthError extends Error {}
/** 서버가 없거나 닿지 않음 */
export class ScriptorOffline extends Error {}
/** 짝 번호를 여러 번 틀려 서버가 잠시 받지 않음 (429): 조금 기다렸다 다시 적는다 */
export class ScriptorBusy extends Error {}

type Fetch = typeof fetch;

export function scriptorBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** 저장해 둔 포트 (이 브라우저). 모르는 값이면 기본 포트 */
export function parsePort(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_BASIC_SCRIPTOR_PORT;
}

export function loadPort(): number {
  try {
    return parsePort(localStorage.getItem(PORT_KEY));
  } catch {
    return DEFAULT_BASIC_SCRIPTOR_PORT;
  }
}

export function savePort(port: number): void {
  try {
    localStorage.setItem(PORT_KEY, String(port));
  } catch {
    // 저장하지 못해도 이번에는 쓴다
  }
}

/**
 * PC 환경인지: 터치 웹킷(아이패드·아이폰), 안드로이드, 정밀한 포인터(마우스)가 없는 기기는 PC가 아니다.
 * 아이패드는 데스크톱 사이트로 Macintosh라 적으므로 터치 점 수로 가린다
 */
export function isPcEnvironment(ua: string, maxTouchPoints: number, finePointer: boolean): boolean {
  if (/iPad|iPhone|iPod|Android|Mobile/i.test(ua)) return false;
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return false;
  return finePointer;
}

export function pcEnvironmentNow(): boolean {
  if (typeof navigator === "undefined") return false;
  const fine = typeof matchMedia !== "undefined" && matchMedia("(any-pointer: fine)").matches;
  return isPcEnvironment(navigator.userAgent, navigator.maxTouchPoints ?? 0, fine);
}

/** 이번 실행 동안의 토큰 (저장하지 않는다) */
let session: { port: number; token: string } | undefined;

export function pairedToken(port: number): string | undefined {
  return session?.port === port ? session.token : undefined;
}

export function forgetPairing(): void {
  session = undefined;
}

/** 사용자가 멈춤 (멈추기·창 닫기) */
export class ScriptorAborted extends Error {}

/**
 * 요청 하나. 시간 제한은 답의 본문을 다 읽을 때까지 걸린다(헤더만 오고 본문이 멈춰도 끊는다).
 * read가 답을 읽고, 닿지 않거나 시간이 넘으면 ScriptorOffline. signal로 멈추면 보내기·받기를 끊고 ScriptorAborted.
 * 리디렉션은 따라가지 않는다: 127.0.0.1로 보낸 음원이 다른 곳으로 넘어가지 않게
 */
async function call<T>(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number, read: (res: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new ScriptorAborted();
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const failure = () => (signal?.aborted ? new ScriptorAborted() : new ScriptorOffline());
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, redirect: "error", signal: ctrl.signal });
    } catch {
      throw failure();
    }
    const timeout = new Promise<never>((_, reject) => {
      if (ctrl.signal.aborted) reject(failure());
      ctrl.signal.addEventListener("abort", () => reject(failure()), { once: true });
    });
    timeout.catch(() => {});
    try {
      return await Promise.race([read(res), timeout]);
    } catch (e) {
      throw ctrl.signal.aborted ? failure() : e;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** 서버가 보낸 /health 답을 읽는다. Basic Scriptor가 아니거나 규격 판이 다르면 undefined */
export function parseHealth(raw: unknown): ScriptorHealth | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  if (v.app !== "basic-scriptor" || v.api !== BASIC_SCRIPTOR_API) return undefined;
  const engines = Array.isArray(v.engines)
    ? v.engines.flatMap((e) => (e && typeof e === "object" && typeof (e as Record<string, unknown>).id === "string" ? [{ id: (e as Record<string, unknown>).id as string, label: asString((e as Record<string, unknown>).label, (e as Record<string, unknown>).id as string), ready: (e as Record<string, unknown>).ready === true }] : []))
    : [];
  const velocity = Array.isArray(v.velocity) ? v.velocity.filter((x): x is string => typeof x === "string") : [];
  return { version: asString(v.version), engines, velocity };
}

export function parseJob(raw: unknown): ScriptorJob {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const states: readonly JobState[] = ["queued", "running", "done", "failed", "cancelled"];
  const state = states.includes(v.state as JobState) ? (v.state as JobState) : "failed";
  const p = typeof v.progress === "number" && Number.isFinite(v.progress) ? Math.min(1, Math.max(0, v.progress)) : 0;
  return { state, progress: p, stage: asString(v.stage), message: asString(v.message) };
}

/** Basic Scriptor가 켜져 있는지 본다. 없으면 undefined */
export async function probe(port: number, fetchImpl: Fetch = fetch): Promise<ScriptorHealth | undefined> {
  try {
    return await call(fetchImpl, `${scriptorBase(port)}/health`, { method: "GET" }, 1500, async (res) => (res.ok ? parseHealth(await res.json()) : undefined));
  } catch {
    return undefined;
  }
}

/** 짝 번호로 토큰을 받는다. 번호가 틀리면 ScriptorAuthError */
export async function pair(port: number, code: string, fetchImpl: Fetch = fetch): Promise<string> {
  const token = await call(fetchImpl, `${scriptorBase(port)}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), client: "BiNote" }) }, 5000, async (res) => {
    if (res.status === 401 || res.status === 403) throw new ScriptorAuthError();
    if (res.status === 429) throw new ScriptorBusy();
    if (!res.ok) throw new ScriptorOffline();
    return asString(((await res.json()) as Record<string, unknown>)?.token);
  });
  if (!token) throw new ScriptorAuthError();
  session = { port, token };
  return token;
}

async function authed<T>(fetchImpl: Fetch, port: number, path: string, init: RequestInit, timeoutMs: number, read: (res: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const token = pairedToken(port);
  if (!token) throw new ScriptorAuthError();
  return call(fetchImpl, `${scriptorBase(port)}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }, timeoutMs, async (res) => {
    if (res.status === 401 || res.status === 403) {
      forgetPairing();
      throw new ScriptorAuthError();
    }
    return read(res);
  }, signal);
}

/** 음원을 보내 받아 적기를 시작한다. 일 번호를 돌려준다 */
export async function startJob(port: number, audio: Blob, name: string, options: ScriptorOptions, fetchImpl: Fetch = fetch, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, name);
  form.append("options", JSON.stringify(options));
  return authed(fetchImpl, port, "/jobs", { method: "POST", body: form }, 120_000, async (res) => {
    if (!res.ok) throw new Error(asString(((await res.json().catch(() => ({}))) as Record<string, unknown>).message, `HTTP ${res.status}`));
    const id = asString(((await res.json()) as Record<string, unknown>).id);
    if (!id) throw new Error("no job id");
    return id;
  }, signal);
}

export async function jobStatus(port: number, id: string, fetchImpl: Fetch = fetch, signal?: AbortSignal): Promise<ScriptorJob> {
  return authed(fetchImpl, port, `/jobs/${encodeURIComponent(id)}`, { method: "GET" }, 10_000, async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseJob(await res.json());
  }, signal);
}

export async function jobResult(port: number, id: string, fetchImpl: Fetch = fetch, signal?: AbortSignal): Promise<Uint8Array> {
  return authed(fetchImpl, port, `/jobs/${encodeURIComponent(id)}/result`, { method: "GET" }, 60_000, async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }, signal);
}

export async function cancelJob(port: number, id: string, fetchImpl: Fetch = fetch): Promise<void> {
  try {
    await authed(fetchImpl, port, `/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }, 5000, async () => undefined);
  } catch {
    // 이미 끝났거나 서버가 꺼졌으면 그만
  }
}
