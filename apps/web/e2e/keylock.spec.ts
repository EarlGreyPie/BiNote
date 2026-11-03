import { expect, exportMml, focusRoll, menu, openApp, pasteAsNewSong, test, trackEditor } from "./fixtures";

// 피아노롤 조표 맞춤 입력과 곡 메뉴 → 조표에 맞추기

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@cfgb;");
  // 조표 맞춤을 켜고 곡 처음 조를 G장조(#1)로
  await page.getByRole("button", { name: "조표 맞춤", exact: true }).click();
  await page.getByRole("combobox", { name: "조표" }).selectOption("1");
});

test("조표에 맞추기: 조 밖 음만 조표대로, 실행 취소 한 번에 돌아간다", async ({ page }) => {
  await menu(page, "곡", /^조표에 맞추기/);
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("곡 전체").check();
  await expect(dialog).toContainText("음 4개 가운데 조 밖 음 1개를 맞춥니다");
  await dialog.getByRole("button", { name: "맞추기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await exportMml(page)).toBe("MML@cf+gb;");
  await page.getByRole("button", { name: "실행 취소" }).click();
  expect(await exportMml(page)).toBe("MML@cfgb;");
});

test("조표 맞춤: ↑는 조 안 음계 한 칸씩, 연필로 찍은 음은 조 안 음", async ({ page }) => {
  await focusRoll(page);
  await page.keyboard.press("Control+A");
  // 화살표는 롤 칸이 초점을 가졌을 때 받는다
  await page.locator("div.roll[role=application]").focus();
  await page.keyboard.press("ArrowUp");
  // G장조: c→d, f(조 밖)→f+로 맞춘 뒤 g, g→a, b→>c
  expect(await exportMml(page)).toBe("MML@dga>c;");

  const roll = page.getByTestId("piano-roll");
  const box = (await roll.boundingBox())!;
  for (let i = 0; i < 12; i++) await roll.click({ position: { x: Math.round(box.width * (0.45 + i * 0.04)), y: Math.round(box.height * (0.25 + i * 0.03)) } });
  const text = (await trackEditor(page).textContent()) ?? "";
  // 찍은 음이 들어갔다
  expect(text.replace(/[^a-g]/g, "").length).toBeGreaterThan(6);
  // G장조 밖 음(f 제자리, c+·d+·g+·a+)이 없다
  expect(text).not.toMatch(/f(?![+#])|[cdga][+#]/);
});

test("조표 맞춤: MML 편집기에서 친 음 글자도 조표대로, 바로 뒤에 친 +는 겹치지 않는다", async ({ page }) => {
  const editor = trackEditor(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("f");
  await expect(editor).toHaveText(/f\+$/);
  await page.keyboard.type("+c");
  await expect(editor).toHaveText(/f\+c$/);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await expect(editor).toHaveText(/gb$/);
  // 바로 뒤에 올림·내림이 이미 있는 자리에 친 음 글자에는 붙이지 않는다 (f++가 되지 않게)
  await page.keyboard.type("c+");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type("f");
  await expect(editor).toHaveText(/gbf\+$/);
  for (let i = 0; i < 2; i++) await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(editor).toHaveText(/gb$/);
  // 조표 맞춤을 끄면 친 그대로
  await focusRoll(page);
  await page.getByRole("button", { name: "조표 맞춤", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("f");
  await expect(editor).toHaveText(/bf$/);
});

test("조표 맞춤: MML 키판의 음 단추도 조표대로", async ({ page }) => {
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "MML 키판" }).or(page.getByRole("menuitem", { name: "MML 키판" })).first().click();
  const editor = trackEditor(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  const pad = page.getByRole("toolbar", { name: "MML 키판" });
  await pad.getByRole("button", { name: "f", exact: true }).click();
  await expect(editor).toHaveText(/bf\+$/);
  // 바로 뒤에 누른 키판 +·-는 붙인 것을 바꾼다 (f++ = G, f+- = F가 되지 않게)
  await pad.getByRole("button", { name: "+", exact: true }).click();
  await expect(editor).toHaveText(/bf\+$/);
  await pad.getByRole("button", { name: "f", exact: true }).click();
  await pad.getByRole("button", { name: "-", exact: true }).click();
  await expect(editor).toHaveText(/bf\+f-$/);
});
