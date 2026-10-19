/**
 * 아이패드(iPadOS 26~) 홈 화면 웹앱을 화면 분할·창 모드로 띄우면 왼쪽 위에 창 단추(●●●)가 앱 위에 겹쳐 그려진다.
 * 전체 화면일 때는 단추가 상태줄 줄에 있어 괜찮다. 그럴 때만 <html>에 ipad-window-controls를 붙여
 * 위 띠 왼쪽을 비우게 한다(app.css). 일반 브라우저 탭에서는 브라우저가 자리를 잡아 주므로 건드리지 않는다
 */
export const WINDOW_CONTROLS_CLASS = "ipad-window-controls";

/** iPad인지 (iPadOS는 데스크톱 Safari처럼 Macintosh라고 알리므로 터치 점 수로 가린다) */
export function isIpad(ua: string, maxTouchPoints: number): boolean {
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** 창 폭이 화면 한 변을 꽉 채우면 전체 화면으로 본다 (iPad는 화면 방향과 상관없이 screen 값이 고정이라 두 변 다 본다) */
export function isFullWidth(innerWidth: number, screenWidth: number, screenHeight: number): boolean {
  return Math.abs(innerWidth - screenWidth) <= 1 || Math.abs(innerWidth - screenHeight) <= 1;
}

export function watchWindowControls() {
  if (typeof window === "undefined" || typeof matchMedia === "undefined") return;
  if (!isIpad(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return;
  const standalone = matchMedia("(display-mode: standalone)");
  const update = () => {
    const on = standalone.matches && !isFullWidth(window.innerWidth, screen.width, screen.height);
    document.documentElement.classList.toggle(WINDOW_CONTROLS_CLASS, on);
  };
  update();
  window.addEventListener("resize", update);
  standalone.addEventListener?.("change", update);
}
