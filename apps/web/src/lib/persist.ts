/**
 * 브라우저에 화면 설정을 기억한다 (탭 모양, 음량, 나란히 보기 등).
 * 저장소가 막힌 브라우저(사생활 보호 창 등)에서는 기본값으로 시작하고 이번 창에서만 쓴다.
 */
export function loadStored<T>(key: string, parse: (raw: string | null) => T): T {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return parse(null);
  }
}

export function saveStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 기억 못 해도 이번 창에서는 그대로 쓴다
  }
}

/** JSON으로 저장한 값을 읽는다. 없거나 깨졌으면 undefined */
export function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
