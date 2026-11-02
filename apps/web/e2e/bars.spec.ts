import { expect, exportMml, menu, openApp, pasteAsNewSong, test } from "./fixtures";

// 곡 메뉴 → 마디 지우기 (볼륨 일괄 조정의 마디 고르기와 같은 창)

test("곡 메뉴 → 마디 지우기: 적은 마디를 모든 트랙에서 지우고 실행 취소 한 번에 돌아간다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@l1cdef,o3l1cdef;");
  await menu(page, "곡", /^마디 지우기/);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("마디 적기").first().check();
  await dialog.getByRole("textbox", { name: "마디 적기" }).fill("2-3");
  await expect(dialog).toContainText("2마디를 지웁니다. 그 안의 음 4개가 지워져요");
  await dialog.getByRole("button", { name: "지우기" }).click();
  await expect(dialog).toBeHidden();
  expect(await exportMml(page)).toBe("MML@l1cf,l1<cf;");
  await page.getByRole("button", { name: "실행 취소" }).click();
  expect(await exportMml(page)).toBe("MML@l1cdef,l1<cdef;");
});
