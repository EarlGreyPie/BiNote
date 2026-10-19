/**
 * 떠 있는 판(메뉴·작은 팝업)을 앱 맨 바깥(#app 끝)으로 옮기는 Svelte 액션.
 * 위 띠처럼 가로 스크롤(overflow)이 있는 칸 안에 fixed 판을 두면, 아이패드 홈 화면 웹앱(WebKit)에서
 * 판이 그 칸에 잘리거나 아래 롤 뒤로 깔려 안 보인다. 칸 밖으로 빼면 어떤 브라우저에서도 맨 위에 뜬다.
 * Svelte 이벤트가 계속 닿도록 body가 아니라 앱을 띄운 #app 안에 둔다
 */
export function portal(node: HTMLElement) {
  const target = document.getElementById("app") ?? document.body;
  target.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
