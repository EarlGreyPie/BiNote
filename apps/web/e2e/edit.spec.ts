import { expect, exportMml, focusRoll, menu, noteCount, openApp, pasteAsNewSong, SAMPLE_MML, test, trackEditor, trackTabs } from "./fixtures";

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

test("트랙 단추를 누른 뒤에도 Ctrl+A·X·V가 화면 글이 아니라 음을 고르고 잘라 붙인다", async ({ page }) => {
  // 단추를 누르면 초점이 단추에 남는다. 그래도 단축키는 롤 음으로 가야 한다 (화면 글 전체 고르기·복사로 새지 않게)
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  await page.keyboard.press("Control+X");
  await expect(noteCount(page)).toHaveText("음 0개");
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+V");
  await expect(noteCount(page)).toHaveText("음 8개");
  expect(await exportMml(page)).toBe(SAMPLE_EXPORT);
});

test("제자리에 붙여넣기(Ctrl+Shift+V)는 재생 커서가 아니라 복사한 원래 자리에 붙인다", async ({ page }) => {
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  // 재생 커서를 곡 끝으로 옮겨도 제자리 붙여넣기는 원래 자리(첫 마디)에 붙는다
  await focusRoll(page);
  await page.keyboard.press("End");
  await trackTabs(page).nth(1).click();
  await page.keyboard.press("Control+Shift+V");
  await expect(page.getByText(/^음 9개$/).first()).toBeVisible();
  // 둘째 트랙의 앞 두 음(c2 e2)은 붙인 음과 겹쳐 지워지고 g2만 남는다
  await expect(noteCount(page)).toHaveText("음 9개");
  expect(await exportMml(page)).toBe("MML@l8cdefgab>c,l8cdefgabb+<g2;");
});

test("피아노롤에서 여러 트랙을 함께 골라 잘라 내고 원래 자리·커서 자리에 트랙마다 붙인다", async ({ page }) => {
  await trackTabs(page).first().click();
  // 첫 트랙 음을 모두 고르고(첫 마디), 그 시간에서 시작하는 모든 트랙 음으로 넓힌다 (Alt+A)
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  await page.keyboard.press("Control+X");
  // 첫 트랙은 모두, 둘째 트랙은 첫 마디에서 시작한 c2 e2가 빠지고 g2만 남는다
  await expect(noteCount(page)).toHaveText("음 0개");
  await trackTabs(page).nth(1).click();
  await expect(noteCount(page)).toHaveText("음 1개");
  // 제자리에 붙이면 트랙마다 원래 트랙·자리로 돌아온다
  await page.keyboard.press("Control+Shift+V");
  await expect(noteCount(page)).toHaveText("음 3개");
  expect(await exportMml(page)).toBe(SAMPLE_EXPORT);
});

test("여러 트랙 복사본은 다른 곡을 열면 버려서, 같은 트랙 id를 가진 다른 곡 트랙에 붙지 않는다", async ({ page }) => {
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Alt+A");
  await page.keyboard.press("Control+C");
  // 다른 곡을 연다 (트랙 id는 또 t1, t2)
  await menu(page, "파일", /^MML@ 붙여넣기/);
  const dialog = page.locator("dialog[open]");
  await dialog.locator("textarea").fill("MML@l1c,l1<c;");
  await dialog.getByRole("button", { name: "새 곡으로 열기" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trackTabs(page)).toHaveCount(2);
  const before = await exportMml(page);
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Control+V");
  expect(await exportMml(page)).toBe(before);
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("고친 트랙만 미리 체크된 내보내기 창에서 악보를 체크하면 채널이 곡 순서대로 들어간다", async ({ page }) => {
  // 한 번 모두 복사해 두면, 다음에는 고친 트랙만 미리 체크된다
  expect(await exportMml(page)).toBe(SAMPLE_EXPORT);
  await trackTabs(page).nth(1).click();
  await expect(trackTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await focusRoll(page);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(trackEditor(page)).toHaveText("l2ceg");
  // 악보 체크로 나머지를 더해도 고친 둘째 트랙이 첫 채널로 오지 않는다
  expect(await exportMml(page)).toBe("MML@l8cdefgab>c,l2ceg;");
});

test("타브에서 두 자리 프렛(12)을 치면 실행 취소 한 번에 지워지고 다시 실행 한 번에 돌아온다", async ({ page }) => {
  await page.getByRole("button", { name: "타브", exact: true }).click();
  // 높은 E줄의 빈 칸(3마디 첫 박)을 눌러 커서를 둔다 (화면 1280x800 기준 자리)
  await page.mouse.click(484, 208);
  await page.keyboard.type("12", { delay: 120 });
  await expect(noteCount(page)).toHaveText("음 9개");
  // 12프렛(o5e)이 들어갔다. 첫 숫자로 넣은 1프렛(f)이 아니다
  await expect(trackEditor(page)).toHaveText("l8t120cdefgab>cr1e16");

  // 전에는 한 번 누르면 친 적 없는 1프렛 음이 남고, 두 번 눌러야 지워졌다
  await page.keyboard.press("Control+Z");
  await expect(noteCount(page)).toHaveText("음 8개");
  await expect(trackEditor(page)).toHaveText("t120l8cdefgab>c");
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();

  await page.keyboard.press("Control+Y");
  await expect(noteCount(page)).toHaveText("음 9개");
  await expect(trackEditor(page)).toHaveText("l8t120cdefgab>cr1e16");
  await expect(page.getByRole("button", { name: "다시 실행" })).toBeDisabled();
});
