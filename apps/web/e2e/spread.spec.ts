import { expect, openApp, pasteAsNewSong, test } from "./fixtures";

/**
 * 화음 분산 칸 (글자 수 맞추기 창). 넘침은 원문이 아니라 게임 글자 수(가장 짧게 다시 쓴 글)로 본다 (rc.5).
 * 전에는 원문 글자 수로 봐서, 원문만 길고 게임에서는 한도 안인 트랙을 넘친다고 하고 자동 고르기는 아무것도 못 골랐다
 */

async function openSpread(page: import("@playwright/test").Page, mml: string) {
  await openApp(page);
  await pasteAsNewSong(page, mml);
  await page.getByRole("button", { name: "곡", exact: true }).click();
  await page.getByRole("menuitem", { name: /^글자 수 맞추기/ }).first().click();
  await page.getByRole("menuitem", { name: /^화음 분산/ }).first().click();
  return page.locator("dialog[open]");
}

test("원문만 길고 게임 글자 수로는 한도 안이면 넘친다고 하지 않는다", async ({ page }) => {
  // 첫 트랙 원문은 음마다 l8을 다시 적어 2400자를 넘지만, 다시 쓰면 l8 한 번이라 한참 짧다
  const dialog = await openSpread(page, `MML@${"l8c".repeat(900)},o3c1;`);
  const source = dialog.getByRole("combobox").first();
  await expect(source.locator("option").first()).not.toContainText("⚠");
  await expect(dialog.getByText(/게임 글자 수로는 이미 2400자 안이에요/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "넘친 만큼 자동으로 고르기" })).toBeDisabled();
  await expect(dialog.getByText(/트랙이 2400자를 넘어요/)).toHaveCount(0);
});

test("게임 글자 수로 넘치면 자동으로 골라 한도 안에 넣는다", async ({ page }) => {
  // 첫 트랙은 16분음표 2600개 (게임 글자 수로도 넘침), 둘째 트랙은 첫 마디만 울린다
  const dialog = await openSpread(page, `MML@o5l16${"cdef".repeat(650)},o3c1;`);
  const source = dialog.getByRole("combobox").first();
  await expect(source.locator("option").first()).toContainText("⚠");
  await dialog.getByRole("button", { name: "넘친 만큼 자동으로 고르기" }).click();
  await expect(dialog.locator("ul.spans input:checked").first()).toBeVisible();
  await expect(dialog.getByRole("table")).toBeVisible();
  // 전후 표에서 바꾼 뒤 한도를 넘는 칸이 없다
  await expect(dialog.locator("table td.full")).toHaveCount(1);
  await dialog.getByRole("button", { name: "적용" }).click();
  await expect(dialog.getByText(/게임 글자 수로는 이미 2400자 안이에요/)).toBeVisible();
});
