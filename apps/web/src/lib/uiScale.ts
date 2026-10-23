/**
 * 화면 배율 (설정 → 화면 → 화면 배율).
 *
 * 소스 CSS는 px로 쓰고, 빌드할 때 아래 PostCSS 플러그인이 px를 rem으로 바꾼다. 뿌리 글자 크기가
 * 16px × 배율이라 rem으로 바뀐 크기(글자·여백·띠 높이·창 크기)가 배율을 따라간다.
 * 그대로 두는 것:
 * - 2px 이하 (테두리·가는 선은 배율과 상관없이 또렷하게)
 * - 대문자로 쓴 `Px` (CSS 단위는 대소문자를 가리지 않으므로 브라우저에서는 px와 같다)
 * - @media 조건. 미디어 조건의 rem은 뿌리 글자 크기를 따르지 않아 바꿔도 소용없다.
 *   @container 조건은 rem이 뿌리 글자 크기를 따르므로 바꾼다
 * - 스타일 안에 `ui-scale: fixed` 주석이 있는 파일 전체. 피아노롤·타브처럼 캔버스 그림과 자리를
 *   맞추는 화면은 캔버스가 배율과 상관없이 그리므로 고정한다 (그 안은 롤·타브 확대로 키운다).
 *   캔버스의 마디 번호·이벤트 줄 글자는 uiScaleNow.svelte.ts로 배율을 곱해 그린다
 */

/** 고를 수 있는 화면 배율(%) */
export const UI_SCALES = [90, 100, 110, 125, 150] as const;
export const DEFAULT_UI_SCALE = 100;

/** rem 1의 기준 px (배율 100%) */
export const REM_BASE = 16;

const PX = /(-?\d*\.?\d+)px\b/g;

/** CSS 값 하나의 px를 rem으로. 2px 이하와 `Px`는 그대로 */
export function pxToRem(value: string): string {
  if (!value.includes("px")) return value;
  return value.replace(PX, (whole, num: string) => {
    const n = Number(num);
    if (!Number.isFinite(n) || Math.abs(n) <= 2) return whole;
    return `${Number((n / REM_BASE).toFixed(5))}rem`;
  });
}

interface CssNode {
  type: string;
  text?: string;
  value?: string;
}
interface CssRoot {
  walkComments(cb: (c: CssNode) => void): void;
  walkDecls(cb: (d: CssNode & { value: string }) => void): void;
  walkAtRules(name: string, cb: (a: CssNode & { params: string }) => void): void;
}

/** Vite의 css.postcss.plugins에 넣는 플러그인 (postcss를 직접 의존하지 않도록 모양만 맞춘다) */
export function pxToRemPlugin(): { postcssPlugin: string; Once(root: CssRoot): void } {
  return {
    postcssPlugin: "mmlce-px-to-rem",
    Once(root) {
      let fixed = false;
      root.walkComments((c) => {
        if (c.text?.includes("ui-scale: fixed")) fixed = true;
      });
      if (fixed) return;
      root.walkDecls((d) => {
        d.value = pxToRem(d.value);
      });
      root.walkAtRules("container", (a) => {
        a.params = pxToRem(a.params);
      });
    },
  };
}
