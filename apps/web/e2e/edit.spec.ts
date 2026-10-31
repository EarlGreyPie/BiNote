import { expect, exportMml, focusRoll, noteCount, openApp, pasteAsNewSong, SAMPLE_MML, test, trackEditor, trackTabs } from "./fixtures";

// MML@ 붙여넣기 → 트랙 생김 → 내보내기 글, 음 편집 → 실행 취소

/** SAMPLE_MML을 연 곡을 내보낸 글. 기본 템포(t120)는 게임도 그렇게 치므로 빠지고, 트랙마다 o4에서 시작하므로 o3은 <로 줄여 적는다 */
const SAMPLE_EXPORT = "MML@l8cdefgab>c,l2<ceg;";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  await expect(trackTabs(page)).toHaveCount(2);
});

test("MML@ 글을 붙여넣으면 트랙이 생기고 내보낸 글이 기대값과 같다", async ({ page }) => {
  await expect(trackTabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(trackEditor(page)).toHaveText("t120l8cdefgab>c");
  await expect(noteCount(page)).toHaveText("음 8개");
  expect(await exportMml(page)).toBe(SAMPLE_EXPORT);

  // 둘째 트랙을 고르면 편집기가 그 트랙 글로 바뀐다
  await trackTabs(page).nth(1).click();
  await expect(trackTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(trackEditor(page)).toHaveText("o3l2ceg");
  await expect(noteCount(page)).toHaveText("음 3개");
});

test("단축키로 음을 한 옥타브 올리고 실행 취소·다시 실행으로 오간다", async ({ page }) => {
  await focusRoll(page);
  // 지금 트랙의 음을 모두 골라 한 옥타브 올린다
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(trackEditor(page)).toHaveText("l8t120>cdefgab>c");
  // 고른 트랙(첫 트랙)만 올라가고 둘째 트랙은 그대로다
  const raised = await exportMml(page);
  expect(raised).toBe("MML@l8>cdefgab>c,l2<ceg;");

  // 위 띠의 실행 취소 단추로 되돌린다
  const undo = page.getByRole("button", { name: "실행 취소" });
  await undo.click();
  await expect(trackEditor(page)).toHaveText("t120l8cdefgab>c");
  expect(await exportMml(page)).toBe(SAMPLE_EXPORT);

  // 다시 실행(Ctrl+Y)으로 올린 상태로 돌아간다
  await focusRoll(page);
  await page.keyboard.press("Control+Y");
  await expect(trackEditor(page)).toHaveText("l8t120>cdefgab>c");
  expect(await exportMml(page)).toBe(raised);
});

test("롤에 연필로 음을 찍고 실행 취소(Ctrl+Z)로 되돌린다", async ({ page }) => {
  const roll = page.getByTestId("piano-roll");
  await expect(roll).toBeVisible();
  const box = (await roll.boundingBox())!;
  // 기본 도구는 연필이다. 붙여넣은 음(1~2마디)이 없는 오른쪽 빈 곳을 누른다
  await roll.click({ position: { x: Math.round(box.width * 0.7), y: Math.round(box.height * 0.4) } });
  await expect(noteCount(page)).toHaveText("음 9개");
  await expect(trackEditor(page)).not.toHaveText("t120l8cdefgab>c");
  expect(await exportMml(page)).not.toBe(SAMPLE_EXPORT);

  await focusRoll(page);
  await page.keyboard.press("Control+Z");
  await expect(noteCount(page)).toHaveText("음 8개");
  await expect(trackEditor(page)).toHaveText("t120l8cdefgab>c");
  expect(await exportMml(page)).toBe(SAMPLE_EXPORT);
});
