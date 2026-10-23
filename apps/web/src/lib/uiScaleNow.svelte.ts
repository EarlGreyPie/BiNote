/**
 * 지금 화면 배율(1 = 100%). 캔버스(피아노롤·타브)는 CSS 배율을 따르지 않으므로, 마디 번호·이벤트 줄 글자처럼
 * 화면 배율을 따라 키울 것은 이 값을 곱해 그린다. 설정이 바뀌면 App이 고친다
 */
export const uiScaleNow = $state({ factor: 1 });

/** 마디 번호·이벤트 줄처럼 화면 배율을 따르는 캔버스 크기(px). 정수로 반올림해 글자·선이 흐리지 않게 한다 */
export function scaledPx(px: number, factor = uiScaleNow.factor): number {
  return Math.round(px * factor);
}
