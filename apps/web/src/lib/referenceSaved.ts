/** 어긋남 ms를 부호 붙여 적는다 (+120ms, -767ms, 0ms). 원곡 줄과 맞춤값 안내가 함께 쓴다 */
export function signedMs(ms: number): string {
  const n = Math.round(ms);
  return `${n > 0 ? "+" : ""}${n}ms`;
}

/**
 * 원곡 줄에 보일 "프로젝트에 적힌 맞춤값". 원곡을 불러오지 않았으면 적힌 값 그대로 (불러오면 이름이 같을 때 그대로 쓰인다),
 * 불러왔는데 이름이 다르면 그 값을 손으로 쓸 수 있게 돌려준다. 이름이 같으면(이미 쓰였으면) 없다
 */
export function savedReferenceHint(
  loaded: { readonly name: string } | undefined,
  saved: { readonly name: string; readonly offsetMs: number } | undefined,
): { readonly name: string; readonly offsetMs: number } | undefined {
  if (!saved) return undefined;
  if (loaded && loaded.name === saved.name) return undefined;
  return { name: saved.name, offsetMs: saved.offsetMs };
}
