/**
 * CP949(ks_c_5601-1987) 인코더. 브라우저는 CP949 읽기만 지원하므로,
 * 처음 쓸 때 읽기 기능으로 2바이트 코드를 모두 풀어 역방향 표를 만든다(앱에 표를 넣지 않음).
 *
 * 브라우저의 "euc-kr"은 WHATWG 표준대로 CP949 전체(확장 한글 포함)를 읽는다.
 * Node(ICU)의 "euc-kr"은 KS X 1001 범위만 읽어서, Node에서는 '똠' 같은 확장 한글이
 * 쓸 수 없는 글자로 잡힌다. 이때도 조용히 깨지지 않고 경고로 알려 준다.
 */
let table: Map<string, number> | undefined;

function buildTable(): Map<string, number> {
  const map = new Map<string, number>();
  const decoder = new TextDecoder("euc-kr", { fatal: true });
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      pair[0] = lead;
      pair[1] = trail;
      let ch: string;
      try {
        ch = decoder.decode(pair);
      } catch {
        continue;
      }
      // 같은 글자가 두 번 나오면 먼저 나온 코드를 쓴다
      if (ch.length === 1 && !map.has(ch)) map.set(ch, (lead << 8) | trail);
    }
  }
  return map;
}

export interface Cp949Result {
  readonly bytes: Uint8Array;
  /** CP949에 없어서 쓰지 못한 글자 (중복 제거, 나온 순서) */
  readonly unencodable: string[];
}

/** 문자열을 CP949 바이트로. 없는 글자는 `?`로 바꾸고 목록으로 알려준다 */
export function encodeCp949(text: string): Cp949Result {
  table ??= buildTable();
  const out: number[] = [];
  const missing = new Set<string>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const mapped = table.get(ch);
    if (mapped === undefined) {
      missing.add(ch);
      out.push(0x3f);
    } else {
      out.push(mapped >> 8, mapped & 0xff);
    }
  }
  return { bytes: Uint8Array.from(out), unencodable: [...missing] };
}
