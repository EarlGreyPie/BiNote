import { expect, openApp, pasteAsNewSong, test } from "./fixtures";

/**
 * 화음 병합 칸 "들어 보기" (rc.4). 곡·반복 구간을 바꾸지 않고 병합 전·후·빠지는 음만을 듣고, 마디로 되풀이해 듣고,
 * 고르기를 바꾸거나 창을 닫으면 멈춘다. 몰기 체크 칸은 꺼 두면 지금과 같다
 */

// 첫 트랙이 늘 울리고, 셋째 트랙 o5c는 첫 트랙 o5c와 겹쳐 2단계에서 빠진다
const SONG = "MML@t120o5c4c4d4d4e4e4f4f4,o4c2d2e2f2,o5c4;";

test("병합 칸에서 빠지는 음을 들어 보고 마디로 되풀이한다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, SONG);
  await page.getByRole("button", { name: "곡", exact: true }).click();
  await page.getByRole("menuitem", { name: /^글자 수 맞추기/ }).first().click();
  await page.getByRole("menuitem", { name: /^화음 병합/ }).first().click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByText("트랙은 남기고 옮길 수 있는 음만 몰기")).toBeVisible();
  // 1단계: 빠지는 음이 없어 들어 보기 줄이 없다
  await dialog.getByText("2단계").click();
  const row = dialog.getByRole("group", { name: "들어 보기" });
  await expect(row).toBeVisible();

  const playing = () => page.evaluate(() => document.querySelector("dialog[open] .listen button.on")?.textContent?.trim() ?? "");
  await row.getByRole("button", { name: /병합 전/ }).click();
  await expect(row.getByRole("button", { name: "■ 멈춤" })).toBeVisible();
  // 다른 단추로 바꾸면 그 소리로 이어 간다
  await row.getByRole("button", { name: /병합 후/ }).click();
  await expect.poll(playing).toBe("■ 멈춤");
  await expect(row.getByRole("button", { name: /▶ 병합 전/ })).toBeVisible();

  // 목록 줄 ▶: 그 마디 되풀이
  await dialog.getByRole("button", { name: "이 마디 되풀이해 듣기" }).first().click();
  await expect(row.getByText("1마디 (1/1)")).toBeVisible();
  await expect(dialog.locator(".gone-list li.here")).toHaveCount(1);
  await row.getByRole("button", { name: /빠지는 음만/ }).click();
  await expect(row.getByText("1마디 (1/1)")).toBeVisible();

  // 고르기를 바꾸면 멈춘다
  await dialog.getByText("3단계").click();
  await expect(row.getByRole("button", { name: "■ 멈춤" })).toHaveCount(0);

  // 듣고 있다가 창을 닫으면 멈춘다 (재생 단추가 다시 재생으로)
  await row.getByRole("button", { name: /병합 전/ }).click();
  await expect(row.getByRole("button", { name: "■ 멈춤" })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).first().click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^재생/ }).first()).toBeVisible();
});
