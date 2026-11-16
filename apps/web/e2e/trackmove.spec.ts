import type { Locator, Page } from "@playwright/test";
import { expect, exportMml, noteCount, openApp, pasteAsNewSong, SAMPLE_MML, test, trackEditor, trackTabs } from "./fixtures";

// 여러 트랙을 함께 고른 음 끌어 옮기기, 트랙 띠·구조 목록에서 트랙을 끌어 순서 바꾸기

/** 두 트랙 모두 롤에 보이는 높이(o4)인 곡: 첫 마디에 4분음표 넷씩 */
const TWO_TRACKS = "MML@l4cdef,l4gab>c;";

/** 피아노롤 기본 화면(1280×800, 가로 롤)에서 음의 가운데: 온음표 160px, 반음 12px, o4c 줄이 y 386 */
const noteAt = (quarter: number, semitonesAboveC4: number) => ({ x: 53 + quarter * 40 + 20, y: 386 - semitonesAboveC4 * 12 });

/** 마우스로 누른 채 여러 걸음에 나눠 끌고 놓는다 (한 번에 건너뛰면 끌기 문턱·놓을 자리 계산을 지나치지 않는다) */
async function dragMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function center(el: Locator, fx = 0.5): Promise<{ x: number; y: number }> {
  const box = (await el.boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height / 2 };
}

/** 위 띠의 실행 취소 단추. 내보내기 창을 닫은 바로 뒤에는 단축키가 창 쪽으로 갈 수 있어 단추로 누른다 (edit.spec.ts와 같다) */
const undo = (page: Page) => page.getByRole("button", { name: "실행 취소" }).click();

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("여러 트랙을 함께 고른 음을 끌면 모든 트랙이 같이 옮겨지고 실행 취소 한 번에 돌아온다", async ({ page }) => {
  await pasteAsNewSong(page, TWO_TRACKS);
  await expect(trackTabs(page)).toHaveCount(2);
  const before = await exportMml(page);
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  // 고르는 트랙(첫 트랙)의 d를 잡고 한 마디 오른쪽으로
  const d = noteAt(1, 2);
  await dragMouse(page, d, { x: d.x + 160, y: d.y });
  expect(await exportMml(page)).toBe("MML@r1cdef,r1gab>c;");
  // 옮긴 뒤에도 여러 트랙 고르기가 남아 있어 이어서 끌 수 있다: 반 마디 왼쪽으로
  const moved = { x: d.x + 160, y: d.y };
  await dragMouse(page, moved, { x: moved.x - 80, y: moved.y });
  expect(await exportMml(page)).toBe("MML@r2cdef,r2gab>c;");
  await undo(page);
  // 실행 취소가 화면에 반영된 뒤에 내보낸다 (편집기 글로 확인)
  await expect(trackEditor(page)).toHaveText("r1cdef");
  expect(await exportMml(page)).toBe("MML@r1cdef,r1gab>c;");
  await undo(page);
  await expect(trackEditor(page)).toHaveText("l4cdef");
  expect(await exportMml(page)).toBe(before);
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("함께 고른 다른 트랙의 음을 잡아 끌어도 모든 트랙이 같이 옮겨지고, 높이도 함께 바뀐다", async ({ page }) => {
  await pasteAsNewSong(page, TWO_TRACKS);
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  // 둘째 트랙의 g를 잡고 한 마디 오른쪽, 반음 둘 위로
  const g = noteAt(0, 7);
  await dragMouse(page, g, { x: g.x + 160, y: g.y - 24 });
  expect(await exportMml(page)).toBe("MML@r1def+g,r1ab>c+d;");
  // 고르는 트랙은 그대로 첫 트랙이다
  await expect(trackTabs(page).first()).toHaveAttribute("aria-selected", "true");
  await undo(page);
  await expect(trackEditor(page)).toHaveText("l4cdef");
  expect(await exportMml(page)).toBe("MML@cdef,gab>c;");
});

test("함께 고른 다른 트랙의 음을 끌지 않고 누르기만 하면 전처럼 그 트랙을 고른다", async ({ page }) => {
  await pasteAsNewSong(page, TWO_TRACKS);
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  const g = noteAt(0, 7);
  await page.mouse.click(g.x, g.y);
  await expect(trackTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  expect(await exportMml(page)).toBe("MML@cdef,gab>c;");
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("여러 트랙을 함께 고르고 방향키를 누르면 모든 트랙이 한 칸씩 옮겨진다", async ({ page }) => {
  await pasteAsNewSong(page, TWO_TRACKS);
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  await page.locator(".roll").first().focus();
  // 격자 1/16 네 칸 = 4분음표 하나
  for (let k = 0; k < 4; k++) await page.keyboard.press("ArrowRight");
  expect(await exportMml(page)).toBe("MML@rcdef,rgab>c;");
  await page.locator(".roll").first().focus();
  await page.keyboard.press("ArrowUp");
  expect(await exportMml(page)).toBe("MML@rc+d+ff+,rg+a+>cc+;");
});

test("여러 트랙 끌기에서 옮긴 자리에 있던 고르지 않은 음은 다른 트랙의 음이어도 지워진 것을 알린다", async ({ page }) => {
  await pasteAsNewSong(page, "MML@l4cdef,l4gab>cd;");
  await trackTabs(page).first().click();
  // 첫 마디에서 시작하는 음만 고른다: 둘째 트랙 둘째 마디의 d는 고르지 않는다
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  const d = noteAt(1, 2);
  await dragMouse(page, d, { x: d.x + 160, y: d.y });
  // 둘째 트랙에서 옮겨 온 g가 그 자리에 있던 d를 먹는다. 첫 트랙에는 먹힐 음이 없다
  await expect(page.getByText("겹친 음 1개가 지워졌어요")).toBeVisible();
  await expect(noteCount(page)).toHaveText("음 4개");
  expect(await exportMml(page)).toBe("MML@r1cdef,r1gab>c;");
  await undo(page);
  await expect(trackEditor(page)).toHaveText("l4cdef");
  expect(await exportMml(page)).toBe("MML@cdef,gab>cd;");
});

test("잠근 트랙이 끼면 여러 트랙 끌기를 통째로 하지 않는다", async ({ page }) => {
  await pasteAsNewSong(page, TWO_TRACKS);
  await trackTabs(page).nth(1).click();
  await page.getByRole("button", { name: "잠그기", exact: true }).first().click();
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  const d = noteAt(1, 2);
  await dragMouse(page, d, { x: d.x + 160, y: d.y });
  await expect(page.getByText("잠근 트랙이라 고치지 않았어요")).toBeVisible();
  expect(await exportMml(page)).toBe("MML@cdef,gab>c;");
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("트랙 띠의 트랙 단추를 마우스로 끌어 순서를 바꾸고 실행 취소로 되돌린다", async ({ page }) => {
  await pasteAsNewSong(page, SAMPLE_MML);
  await expect(trackTabs(page)).toHaveCount(2);
  const before = await exportMml(page);
  // 첫 트랙 단추를 둘째 단추의 오른쪽 반에 놓는다
  await dragMouse(page, await center(trackTabs(page).first()), await center(trackTabs(page).nth(1), 0.8));
  await expect(trackTabs(page).first()).toContainText("연주자 1-2");
  await expect(trackTabs(page).nth(1)).toContainText("연주자 1-1");
  expect(await exportMml(page)).toBe("MML@l2<ceg,l8cdefgab>c;");
  // 끌기는 누르기가 아니다: 끌어 온 단추의 트랙을 새로 고르지 않는다 (처음 고른 첫 트랙 그대로)
  await expect(trackTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await undo(page);
  await expect(trackTabs(page).first()).toContainText("연주자 1-1");
  expect(await exportMml(page)).toBe(before);
  // 조금만 움직인 누르기는 끌기가 아니라 고르기다
  const second = await center(trackTabs(page).nth(1));
  await dragMouse(page, second, { x: second.x + 3, y: second.y });
  await expect(trackTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("트랙 단추를 누른 채 조금만 움직여 밖에서 놓으면, 버튼을 놓은 채 다른 단추로 돌아와도 끌기가 시작되지 않는다", async ({ page }) => {
  await pasteAsNewSong(page, SAMPLE_MML);
  const box = (await trackTabs(page).first().boundingBox())!;
  // 단추 아래 끝을 눌러 끌기 문턱보다 적게 움직여 단추 밖으로 나가 놓는다 (pointerup이 단추로 오지 않는다)
  const edge = { x: box.x + box.width / 2, y: box.y + box.height - 1 };
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x, edge.y + 3, { steps: 2 });
  await page.mouse.up();
  // 버튼을 놓은 채 단추 위를 지나 둘째 단추에서 누르고 놓는다: 트랙을 고르기만 하고 옮기지 않는다
  const to = await center(trackTabs(page).nth(1), 0.8);
  await page.mouse.move(edge.x, edge.y - 4, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(trackTabs(page).first()).toContainText("연주자 1-1");
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("트랙 단추를 끄는 중 Esc를 누르면 옮기지 않는다", async ({ page }) => {
  await pasteAsNewSong(page, SAMPLE_MML);
  const from = await center(trackTabs(page).first());
  const to = await center(trackTabs(page).nth(1), 0.8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(trackTabs(page).first()).toContainText("연주자 1-1");
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("구조 목록의 트랙 줄을 마우스로 끌어 순서를 바꾼다 (끄기 표시는 트랙을 따라간다)", async ({ page }) => {
  await pasteAsNewSong(page, SAMPLE_MML);
  await page.getByRole("button", { name: "구조 목록 펼치기" }).click();
  const rows = page.locator(".structure-list .track-row");
  await expect(rows).toHaveCount(2);
  // 첫 트랙을 끄고(M), 그 줄의 이름을 잡아 둘째 줄 아래쪽 반에 놓는다
  await rows.first().getByRole("button", { name: "M", exact: true }).click();
  const from = await center(rows.first().locator(".tname"));
  const target = (await rows.nth(1).boundingBox())!;
  await dragMouse(page, from, { x: from.x, y: target.y + target.height * 0.8 });
  await expect(rows.first()).toContainText("연주자 1-2");
  await expect(rows.nth(1)).toContainText("연주자 1-1");
  await expect(rows.nth(1).getByRole("button", { name: "M", exact: true })).toHaveClass(/lit/);
  await expect(rows.first().getByRole("button", { name: "M", exact: true })).not.toHaveClass(/lit/);
  await page.keyboard.press("Escape");
  expect(await exportMml(page)).toBe("MML@l2<ceg,l8cdefgab>c;");
});
