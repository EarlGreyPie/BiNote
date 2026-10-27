/**
 * MusicXML을 읽을 만큼만 하는 작은 XML 읽기. 브라우저 DOMParser가 없는 곳(테스트·작업 스레드)에서도 같게 돈다.
 * 요소·속성·글자만 남기고 선언·주석·DOCTYPE·처리 명령은 건너뛴다. 이름공간 앞머리는 그대로 둔다
 */
export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  /** 바로 아래 글자를 이어 붙인 것 (앞뒤 빈칸은 그대로) */
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** 글을 요소 나무로. 뿌리 요소를 돌려준다. 닫는 태그가 맞지 않으면 XmlError */
export function parseXml(source: string): XmlElement {
  const s = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let i = 0;
  const fail = (why: string): never => {
    throw new XmlError(`${why} (${i})`);
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    const textEnd = lt < 0 ? s.length : lt;
    if (textEnd > i && stack.length > 0) stack[stack.length - 1]!.text += decodeEntities(s.slice(i, textEnd));
    if (lt < 0) break;
    i = lt;
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) fail("주석이 닫히지 않았습니다");
      i = end + 3;
    } else if (s.startsWith("<![CDATA[", i)) {
      const end = s.indexOf("]]>", i + 9);
      if (end < 0) fail("CDATA가 닫히지 않았습니다");
      if (stack.length > 0) stack[stack.length - 1]!.text += s.slice(i + 9, end);
      i = end + 3;
    } else if (s.startsWith("<?", i)) {
      const end = s.indexOf("?>", i + 2);
      if (end < 0) fail("처리 명령이 닫히지 않았습니다");
      i = end + 2;
    } else if (s.startsWith("<!", i)) {
      // DOCTYPE: 안쪽 [ ... ] 묶음까지 건너뛴다
      let depth = 0;
      let j = i + 2;
      for (; j < s.length; j++) {
        const c = s[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else if (s[i + 1] === "/") {
      const end = s.indexOf(">", i);
      if (end < 0) fail("닫는 태그가 끝나지 않았습니다");
      const name = s.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`닫는 태그 ${name}가 맞지 않습니다`);
      i = end + 1;
    } else {
      // 여는 태그: 따옴표 안의 > 는 건너뛴다
      let j = i + 1;
      let quote = "";
      for (; j < s.length; j++) {
        const c = s[j]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= s.length) fail("태그가 끝나지 않았습니다");
      let body = s.slice(i + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const nameMatch = /^[^\s/>]+/.exec(body);
      if (!nameMatch) fail("태그 이름이 없습니다");
      const attrs: Record<string, string> = {};
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      const rest = body.slice(nameMatch![0].length);
      for (let m = attrRe.exec(rest); m; m = attrRe.exec(rest)) attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? "");
      const el: XmlElement = { name: nameMatch![0], attrs, children: [], text: "" };
      if (stack.length > 0) stack[stack.length - 1]!.children.push(el);
      else if (!root) root = el;
      else fail("뿌리 요소가 둘입니다");
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  if (stack.length > 0) fail(`${stack[stack.length - 1]!.name}가 닫히지 않았습니다`);
  if (!root) throw new XmlError("요소가 없습니다");
  return root;
}

/** 이름이 같은 첫 아이 요소 */
export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

/** 이름이 같은 아이 요소 모두 */
export function childrenOf(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/** 이름 길을 따라 내려간 요소의 글자 (앞뒤 빈칸 뺌). 없으면 undefined */
export function textAt(el: XmlElement | undefined, ...path: string[]): string | undefined {
  let at = el;
  for (const name of path) at = child(at, name);
  return at ? at.text.trim() : undefined;
}

/** 이름 길을 따라 내려간 요소의 숫자. 없거나 숫자가 아니면 undefined */
export function numberAt(el: XmlElement | undefined, ...path: string[]): number | undefined {
  const text = textAt(el, ...path);
  if (text === undefined || text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** XML 글자·속성 값으로 쓸 수 있게 바꾼다 */
export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
