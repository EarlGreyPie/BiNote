/**
 * 메뉴 판의 키보드 이동과 하위 메뉴 여는 방식.
 * 하위 메뉴는 눌러서 연다(아이패드는 마우스를 올려 여는 방식이 없다).
 * 넓은 화면의 마우스에서는 옆에 펼치고, 터치나 좁은 화면에서는 같은 판이 하위 목록으로 바뀐다
 */

/** 줄 하나가 고를 수 있는지만 본다 (구분선·꺼진 줄은 건너뛴다) */
export interface NavRow {
  readonly separator?: true;
  readonly disabled?: boolean;
}

/**
 * from에서 dir(+1 아래, -1 위) 쪽으로 다음 고를 수 있는 줄. 끝에서는 반대쪽으로 돈다.
 * from이 -1이면 처음(아래로)이나 끝(위로)에서 찾는다. 고를 줄이 없으면 -1
 */
export function nextRow(rows: readonly NavRow[], from: number, dir: 1 | -1): number {
  const n = rows.length;
  if (n === 0) return -1;
  let i = from < 0 ? (dir === 1 ? -1 : n) : from;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    const row = rows[i];
    if (row && !row.separator && !row.disabled) return i;
  }
  return -1;
}

/** 옆 펼침 판이 들어갈 만한 너비 (판 최소 너비 220px + 여유) */
const FLYOUT_WIDTH = 260;

/** 하위 메뉴를 옆에 펼칠지(flyout), 같은 판을 바꿀지(drill) */
export function subMenuMode(coarse: boolean, viewportWidth: number, panelWidth: number): "flyout" | "drill" {
  if (coarse) return "drill";
  return viewportWidth >= panelWidth + FLYOUT_WIDTH + 8 ? "flyout" : "drill";
}

/**
 * 옆 펼침 판의 가로 자리. 부모 판 오른쪽에 들어가면 오른쪽, 아니면 왼쪽에 붙인다.
 * 양쪽 다 하위 판(실제 너비)이 들어갈 자리가 없으면 undefined: 같은 판을 바꾸는 방식(drill)으로 연다.
 * left/right 중 하나만 쓴다
 */
export function flyoutPlace(
  panelLeft: number,
  panelRight: number,
  subWidth: number,
  viewportWidth: number,
): { left: number } | { right: number } | undefined {
  const margin = 4;
  if (panelRight + 2 + subWidth <= viewportWidth - margin) return { left: panelRight + 2 };
  if (panelLeft - 2 - subWidth >= margin) return { right: viewportWidth - panelLeft + 2 };
  return undefined;
}
