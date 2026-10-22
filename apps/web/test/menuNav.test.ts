import { describe, expect, it } from "vitest";
import { flyoutPlace, nextRow, subMenuMode } from "../src/lib/menuNav";

describe("메뉴 키보드 이동", () => {
  const rows = [{}, { separator: true as const }, { disabled: true }, {}, {}];

  it("구분선과 꺼진 줄을 건너뛴다", () => {
    expect(nextRow(rows, 0, 1)).toBe(3);
    expect(nextRow(rows, 3, -1)).toBe(0);
  });

  it("끝에서 반대쪽으로 돈다", () => {
    expect(nextRow(rows, 4, 1)).toBe(0);
    expect(nextRow(rows, 0, -1)).toBe(4);
  });

  it("처음 들어올 때는 첫 줄(아래로)이나 끝 줄(위로)", () => {
    expect(nextRow(rows, -1, 1)).toBe(0);
    expect(nextRow(rows, -1, -1)).toBe(4);
  });

  it("고를 줄이 없으면 -1", () => {
    expect(nextRow([], -1, 1)).toBe(-1);
    expect(nextRow([{ disabled: true }, { separator: true }], -1, 1)).toBe(-1);
  });
});

describe("하위 메뉴 여는 방식", () => {
  it("터치는 늘 같은 판을 바꾼다", () => {
    expect(subMenuMode(true, 1600, 240)).toBe("drill");
  });

  it("마우스는 옆에 펼칠 자리가 있으면 옆으로, 좁으면 같은 판을 바꾼다", () => {
    expect(subMenuMode(false, 1280, 240)).toBe("flyout");
    expect(subMenuMode(false, 480, 240)).toBe("drill");
  });

  it("오른쪽에 자리가 없으면 부모 판 왼쪽에 붙인다", () => {
    expect(flyoutPlace(100, 340, 240, 1280)).toEqual({ left: 342 });
    expect(flyoutPlace(1000, 1240, 240, 1280)).toEqual({ right: 282 });
  });

  it("양쪽 다 하위 판이 들어가지 않으면 같은 판을 바꾼다 (화면 밖으로 나가지 않게)", () => {
    // 600px 화면, 부모 판 [170, 400], 하위 판 230px: 오른쪽 196px·왼쪽 166px 모두 모자람
    expect(flyoutPlace(170, 400, 230, 600)).toBeUndefined();
  });
});
