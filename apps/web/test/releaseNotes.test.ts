import { afterEach, describe, expect, it, vi } from "vitest";
import { changelogSection, fetchRelease, renderNotes } from "../src/lib/releaseNotes";

const CHANGELOG = `# 바뀐 내용

머리말

## 1.0.0-beta.8 (2026-10-17)

### 새 기능
- 하나

## 1.0.0-beta.7 (2026-10-17)

- 둘
`;

describe("changelogSection", () => {
  it("그 판의 절만 꺼낸다 (제목 줄 빼고)", () => {
    expect(changelogSection(CHANGELOG, "1.0.0-beta.8")).toBe("### 새 기능\n- 하나");
    expect(changelogSection(CHANGELOG, "1.0.0-beta.7")).toBe("- 둘");
  });
  it("앞부분만 같은 판 번호는 고르지 않는다", () => {
    expect(changelogSection(CHANGELOG, "1.0.0-beta")).toBe("");
    expect(changelogSection(CHANGELOG, "1.0.0")).toBe("");
  });
});

describe("renderNotes", () => {
  it("제목·목록·굵게·코드·링크", () => {
    expect(renderNotes("### 새 기능\n- **굵게** `a4&r4`\n- [링크](https://example.com/x)")).toBe(
      '<h5>새 기능</h5><ul><li><strong>굵게</strong> <code>a4&amp;r4</code></li><li><a href="https://example.com/x" target="_blank" rel="noopener">링크</a></li></ul>',
    );
  });
  it("HTML은 글자로 보이고 https가 아닌 링크는 걸지 않는다", () => {
    const html = renderNotes('<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("href");
    expect(html).toContain("&lt;img");
  });
  it("문단과 이어진 목록 줄", () => {
    expect(renderNotes("첫 줄\n둘째 줄\n\n- 항목\n  이어짐")).toBe("<p>첫 줄 둘째 줄</p><ul><li>항목 이어짐</li></ul>");
  });
});

describe("renderNotes 특수 입력", () => {
  it("$ 기호가 든 이어진 목록 줄을 그대로 둔다", () => {
    expect(renderNotes("- a\n  $` $' $&")).toBe("<ul><li>a $` $' $&amp;</li></ul>");
  });
  it("닫히지 않은 [ ` ** 가 많아도 빨리 끝난다", () => {
    const start = performance.now();
    renderNotes("[`**".repeat(20_000));
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("fetchRelease", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("응답이 멈추면 시간 초과로 null", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const result = fetchRelease("o/r", "1.0.0");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
  });
  it("본문과 주소를 읽는다", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ body: " 내용 ", html_url: "https://github.com/o/r/releases/tag/v1" })));
    expect(await fetchRelease("o/r", "1")).toEqual({ text: "내용", url: "https://github.com/o/r/releases/tag/v1" });
  });
});
