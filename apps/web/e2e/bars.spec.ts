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

test("곡 메뉴 → 템포 ▸ → 템포 한꺼번에 바꾸기: 적은 마디만 바꾸고 뒤는 원래 템포, 실행 취소 한 번에 돌아간다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l1cdef,l1<cdef;");
  await page.getByRole("button", { name: "곡", exact: true }).click();
  await page.getByRole("menuitem", { name: /^템포/ }).click();
  await page.getByRole("menuitem", { name: /^템포 한꺼번에 바꾸기/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("마디 적기").first().check();
  await dialog.getByRole("textbox", { name: "마디 적기" }).fill("2-3");
  await dialog.getByRole("spinbutton").fill("90");
  await dialog.getByRole("button", { name: "적용" }).click();
  await expect(dialog).toBeHidden();
  const out = await exportMml(page);
  expect(out).toContain("t90");
  // 악보 안 어느 트랙에 적힌 t든 악보 전체 빠르기다: 2마디에 t90, 4마디에 원래 t120
  expect(out).toBe("MML@l1ct90def,l1<cdet120f;");
  await page.getByRole("button", { name: "실행 취소" }).click();
  expect(await exportMml(page)).not.toContain("t90");
});

test("곡 메뉴 → 음정 변환: 적은 마디만 옮기고 & 사슬은 첫 음 마디를 따르며, 실행 취소 한 번에 돌아간다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@l1cdef&f,l1<cdef;");
  await menu(page, "곡", /^음정 변환/);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("곡 전체").check();
  await dialog.getByLabel("마디 적기").first().check();
  await dialog.getByRole("textbox", { name: "마디 적기" }).fill("2, 4");
  await dialog.getByRole("button", { name: "+1" }).click();
  await dialog.getByRole("button", { name: "+1" }).click();
  await dialog.getByRole("button", { name: "적용" }).click();
  await expect(dialog).toBeHidden();
  // 2마디 d → e, 4마디에서 시작한 f&f는 5마디까지 사슬째 g&g, 3마디 e는 그대로
  expect(await exportMml(page)).toBe("MML@l1ceeg&g,l1<ceeg;");
  await page.getByRole("button", { name: "실행 취소" }).click();
  expect(await exportMml(page)).toBe("MML@l1cdef&f,l1<cdef;");
});
