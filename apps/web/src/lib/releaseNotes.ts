/**
 * 새 판의 바뀐 내용. 공개 사이트는 GitHub Releases의 그 판 본문을 읽고,
 * 못 읽으면(아직 안 올렸거나, 오프라인, 요청 한도) 새 판 서비스 워커에 든 CHANGELOG 절을 쓴다.
 * 테스트 사이트는 Releases가 없어 늘 CHANGELOG 절이다
 */

/** CHANGELOG.md에서 이 판의 절("## 판 번호 (날짜)"부터 다음 "## " 앞까지, 제목 줄 빼고). 없으면 "" */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## ") && l.slice(3).trim().split(/\s/)[0] === version);
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

export interface ReleaseNotes {
  /** 본문 (Markdown) */
  text: string;
  /** GitHub Releases 쪽 주소. CHANGELOG에서 왔으면 없다 */
  url?: string;
}

/** GitHub 응답을 이만큼 기다린다. 넘으면 못 읽은 것으로 보고 CHANGELOG 절을 쓴다 */
const FETCH_TIMEOUT_MS = 8000;

/** GitHub Releases에서 그 판(태그 v판번호)의 본문을 읽는다. 없거나 못 읽으면(시간 초과 포함) null */
export async function fetchRelease(repo: string, version: string, signal: AbortSignal | null = null): Promise<ReleaseNotes | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  const cancel = () => abort.abort();
  signal?.addEventListener("abort", cancel);
  if (signal?.aborted) abort.abort();
  try {
    // 본문 읽기(json)까지 같은 신호라 응답이 오다 멈춰도 시간 초과로 끝난다
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${encodeURIComponent(version)}`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { body?: unknown; html_url?: unknown; draft?: unknown };
    if (data.draft || typeof data.body !== "string" || !data.body.trim()) return null;
    const text = data.body.trim();
    return typeof data.html_url === "string" ? { text, url: data.html_url } : { text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 한 줄 안의 꾸밈: `코드`, **굵게**, [글](https://…). 나머지는 모두 글자 그대로 (HTML은 이스케이프) */
function inline(text: string): string {
  let out = "";
  // 길이를 묶어 둔다. 닫히지 않은 ` ** [ 가 많아도 줄 끝까지 거듭 훑지 않게
  const re = /`([^`\n]{1,200})`|\*\*(.{1,500}?)\*\*|\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<strong>${inline(m[2])}</strong>`;
    else out += `<a href="${escapeHtml(m[4] ?? "")}" target="_blank" rel="noopener">${escapeHtml(m[3] ?? "")}</a>`;
    last = re.lastIndex;
  }
  return out + escapeHtml(text.slice(last));
}

/** 그릴 본문의 최대 글자 수 */
const MAX_NOTES = 50_000;

/**
 * 바뀐 내용에 쓰는 만큼만 Markdown을 HTML로 바꾼다: 제목(#~####), 목록(- *), 문단, 줄 안 꾸밈.
 * 본문은 밖(GitHub)에서 오므로 HTML 태그는 쓰지 않고 모두 글자로 보인다. 링크는 https만 건다
 */
export function renderNotes(markdown: string): string {
  // 바뀐 내용은 길어야 몇 KB다. 아주 긴 본문은 뒤를 자른다
  if (markdown.length > MAX_NOTES) markdown = `${markdown.slice(0, MAX_NOTES)}…`;
  const out: string[] = [];
  let list = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
      closeList();
    } else if (heading) {
      flush();
      closeList();
      // 창 제목 아래에 들어가므로 h3부터 쓴다
      const [, marks = "", title = ""] = heading;
      const level = Math.min(6, marks.length + 2);
      out.push(`<h${level}>${inline(title)}</h${level}>`);
    } else if (item) {
      flush();
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(item[1] ?? "")}</li>`);
    } else if (list && /^\s+/.test(raw)) {
      // 목록 항목이 다음 줄로 이어진 것
      const last = out.pop()!;
      out.push(`${last.slice(0, -"</li>".length)} ${inline(line.trim())}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flush();
  closeList();
  return out.join("");
}
