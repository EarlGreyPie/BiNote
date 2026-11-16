/**
 * 단축키를 막아야 하는 대화 상자가 열려 있는지.
 *
 * 원곡 대조 셈여림·연주 누락음 고치기·어긋난 길이 찾기·접힘 검토처럼 `show()`로 띄운 모달 아닌 창은
 * 뒤의 편집기를 그대로 쓰라고 띄운 것이므로 세지 않는다. 이런 창까지 세면 Ctrl+S가 곡 저장 대신
 * 브라우저의 "페이지 저장"(HTML)으로 넘어간다.
 * `:modal`을 모르는 오래된 브라우저에서는 예전처럼 열린 창을 모두 모달로 본다.
 */
export function modalOpen(dialogs: Iterable<Pick<Element, "matches">>): boolean {
  for (const d of dialogs) {
    try {
      if (d.matches(":modal")) return true;
    } catch {
      return true;
    }
  }
  return false;
}
