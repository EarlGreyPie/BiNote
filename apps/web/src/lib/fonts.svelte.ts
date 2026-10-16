/**
 * 캔버스는 글꼴이 늦게 도착해도 다시 그려지지 않으므로, 글꼴을 다 받을 때마다 값을 올려
 * 그리기 효과가 이 값을 읽게 한다.
 */
export const fonts = $state({ loaded: 0 });

if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener("loadingdone", () => fonts.loaded++);
  void document.fonts.ready.then(() => fonts.loaded++);
}
