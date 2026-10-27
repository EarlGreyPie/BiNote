import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetPairing,
  isPcEnvironment,
  jobStatus,
  pair,
  pairedToken,
  parseHealth,
  parseJob,
  parsePort,
  probe,
  ScriptorAborted,
  ScriptorAuthError,
  ScriptorOffline,
  startJob,
  jobResult,
  DEFAULT_BASIC_SCRIPTOR_PORT,
} from "../src/lib/basicScriptor";

type Call = { url: string; init: RequestInit };

/** 정해 둔 답을 주는 가짜 fetch (부른 것을 적어 둔다) */
function fakeFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const HEALTH = { app: "basic-scriptor", api: 1, version: "0.1.0", engines: [{ id: "muscriptor", label: "MuScriptor", ready: false }, { id: "basic-pitch", label: "basic-pitch", ready: true }], velocity: ["sfproxy"] };

afterEach(() => forgetPairing());

describe("PC 환경 판단", () => {
  const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  it("윈도·맥 마우스는 PC", () => {
    expect(isPcEnvironment(WIN, 0, true)).toBe(true);
    expect(isPcEnvironment(WIN, 10, true)).toBe(true); // 터치 노트북도 마우스가 있으면 PC
    expect(isPcEnvironment(MAC, 0, true)).toBe(true);
  });
  it("아이패드(데스크톱 사이트 포함)·휴대폰·마우스 없는 기기는 PC가 아니다", () => {
    expect(isPcEnvironment(MAC, 5, true)).toBe(false);
    expect(isPcEnvironment("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5, false)).toBe(false);
    expect(isPcEnvironment("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile", 5, false)).toBe(false);
    expect(isPcEnvironment(WIN, 10, false)).toBe(false);
  });
});

describe("Basic Scriptor 규격 읽기", () => {
  it("health: Basic Scriptor 규격 1판만 받는다", () => {
    expect(parseHealth(HEALTH)).toEqual({ version: "0.1.0", engines: [{ id: "muscriptor", label: "MuScriptor", ready: false }, { id: "basic-pitch", label: "basic-pitch", ready: true }], velocity: ["sfproxy"] });
    expect(parseHealth({ ...HEALTH, api: 2 })).toBeUndefined();
    expect(parseHealth({ ...HEALTH, app: "something-else" })).toBeUndefined();
    expect(parseHealth("nope")).toBeUndefined();
  });
  it("job: 모르는 상태는 실패, 진행률은 0~1", () => {
    expect(parseJob({ state: "running", progress: 1.7, stage: "transcribe" })).toEqual({ state: "running", progress: 1, stage: "transcribe", message: "" });
    expect(parseJob({ state: "weird" }).state).toBe("failed");
  });
  it("포트: 1024~65535 정수만, 아니면 기본", () => {
    expect(parsePort("50000")).toBe(50000);
    expect(parsePort("80")).toBe(DEFAULT_BASIC_SCRIPTOR_PORT);
    expect(parsePort(null)).toBe(DEFAULT_BASIC_SCRIPTOR_PORT);
  });
});

describe("Basic Scriptor 주고받기", () => {
  it("찾기: 이 컴퓨터(127.0.0.1)의 /health만 부른다. 닿지 않으면 없음", async () => {
    const ok = fakeFetch(() => json(HEALTH));
    expect((await probe(47811, ok.impl))?.version).toBe("0.1.0");
    expect(ok.calls[0]!.url).toBe("http://127.0.0.1:47811/health");
    const down = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await probe(47811, down.impl)).toBeUndefined();
  });

  it("짝 맞추기: 맞는 번호면 토큰을 메모리에만 두고, 틀리면 ScriptorAuthError", async () => {
    const wrong = fakeFetch(() => json({ message: "bad code" }, 403));
    await expect(pair(47811, "000000", wrong.impl)).rejects.toBeInstanceOf(ScriptorAuthError);
    expect(pairedToken(47811)).toBeUndefined();
    const right = fakeFetch(() => json({ token: "tok-1" }));
    await pair(47811, " 123456 ", right.impl);
    expect(JSON.parse(String(right.calls[0]!.init.body))).toEqual({ code: "123456", client: "BiNote" });
    expect(pairedToken(47811)).toBe("tok-1");
    expect(pairedToken(50000)).toBeUndefined();
  });

  it("음원 보내기: 토큰을 붙여 보내고, 서버가 토큰을 거절하면 짝을 푼다", async () => {
    await pair(47811, "1", fakeFetch(() => json({ token: "tok-2" })).impl);
    const server = fakeFetch(() => json({ id: "job-9" }, 202));
    const id = await startJob(47811, new Blob([new Uint8Array(4)]), "song.wav", { engine: "basic-pitch", velocity: "none", instrument: "auto" }, server.impl);
    expect(id).toBe("job-9");
    expect(server.calls[0]!.url).toBe("http://127.0.0.1:47811/jobs");
    expect((server.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-2");
    const form = server.calls[0]!.init.body as FormData;
    expect(JSON.parse(String(form.get("options")))).toEqual({ engine: "basic-pitch", velocity: "none", instrument: "auto" });

    const expired = fakeFetch(() => json({}, 401));
    await expect(jobStatus(47811, "job-9", expired.impl)).rejects.toBeInstanceOf(ScriptorAuthError);
    expect(pairedToken(47811)).toBeUndefined();
  });

  it("짝을 맞추지 않았으면 보내지 않는다", async () => {
    const server = fakeFetch(() => json({ id: "x" }));
    await expect(startJob(47811, new Blob([]), "a.wav", { engine: "e", velocity: "none", instrument: "auto" }, server.impl)).rejects.toBeInstanceOf(ScriptorAuthError);
    expect(server.calls).toHaveLength(0);
  });
});

describe("시간 제한", () => {
  afterEach(() => vi.useRealTimers());

  it("헤더만 오고 본문이 멈추면 본문 읽기까지 시간 제한으로 끊는다", async () => {
    await pair(47811, "123456", fakeFetch(() => json({ token: "t" })).impl);
    vi.useFakeTimers();
    // 본문이 끝나지 않는 답
    const stuck = fakeFetch(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const status = jobStatus(47811, "j1", stuck.impl);
    const settled = expect(status).rejects.toBeInstanceOf(ScriptorOffline);
    await vi.advanceTimersByTimeAsync(10_001);
    await settled;
    expect(stuck.calls[0]!.init.signal?.aborted).toBe(true);
  });

  it("/health 본문이 멈춰도 찾기는 없음으로 끝난다", async () => {
    vi.useFakeTimers();
    const stuck = fakeFetch(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const found = probe(47811, stuck.impl);
    await vi.advanceTimersByTimeAsync(1501);
    expect(await found).toBeUndefined();
  });
});

describe("멈추기와 리디렉션", () => {
  it("멈추면 보내는 중인 음원 요청을 끊는다", async () => {
    await pair(47811, "123456", fakeFetch(() => json({ token: "t" })).impl);
    let seen: AbortSignal | undefined;
    // 신호가 끊길 때까지 답하지 않는 서버
    const slow = fakeFetch(
      (call) =>
        new Promise<Response>((_, reject) => {
          seen = call.init.signal ?? undefined;
          seen?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const ctrl = new AbortController();
    const sending = startJob(47811, new Blob(["x"]), "a.wav", { engine: "e", velocity: "none", instrument: "auto" }, slow.impl, ctrl.signal);
    const settled = expect(sending).rejects.toBeInstanceOf(ScriptorAborted);
    ctrl.abort();
    await settled;
    expect(seen?.aborted).toBe(true);
  });

  it("결과를 받는 중 멈추면 본문 읽기도 끊는다", async () => {
    await pair(47811, "123456", fakeFetch(() => json({ token: "t" })).impl);
    const stuck = fakeFetch(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const ctrl = new AbortController();
    const result = jobResult(47811, "j1", stuck.impl, ctrl.signal);
    const settled = expect(result).rejects.toBeInstanceOf(ScriptorAborted);
    ctrl.abort();
    await settled;
  });

  it("이미 멈춘 신호면 보내지 않는다", async () => {
    await pair(47811, "123456", fakeFetch(() => json({ token: "t" })).impl);
    const server = fakeFetch(() => json({ id: "x" }));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(startJob(47811, new Blob([]), "a.wav", { engine: "e", velocity: "none", instrument: "auto" }, server.impl, ctrl.signal)).rejects.toBeInstanceOf(ScriptorAborted);
    expect(server.calls).toHaveLength(0);
  });

  it("모든 요청이 리디렉션을 따라가지 않는다 (음원이 이 컴퓨터 밖으로 넘어가지 않게)", async () => {
    const server = fakeFetch((call) => (call.url.endsWith("/pair") ? json({ token: "t" }) : call.url.endsWith("/health") ? json(HEALTH) : json({ id: "x" }, 202)));
    await probe(47811, server.impl);
    await pair(47811, "123456", server.impl);
    await startJob(47811, new Blob(["x"]), "a.wav", { engine: "e", velocity: "none", instrument: "auto" }, server.impl);
    expect(server.calls).toHaveLength(3);
    for (const call of server.calls) expect(call.init.redirect).toBe("error");
  });
});

