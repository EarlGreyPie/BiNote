import { expect, menu, openApp, pasteAsNewSong, SAMPLE_MML, test } from "./fixtures";

// 실험실 작업 메모: Alt+N으로 넣고, 목록 패널에서 끝냄을 체크하고, 실행 취소로 돌아온다

test("실험실 작업 메모: 넣기 → 목록 → 끝냄 → 실행 취소", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mmlce.labs", "1"));
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);

  // 커서가 없으면 곡 처음에 넣는다
  await page.keyboard.press("Alt+N");
  const dialog = page.locator("dialog[open]", { hasText: "메모 넣기" });
  await expect(dialog.getByText("자리: 1:1")).toBeVisible();
  await dialog.getByRole("textbox").fill("여기부터 다시 확인");
  await dialog.getByRole("textbox").press("Enter");
  await expect(dialog).toHaveCount(0);

  await menu(page, "실험실", "작업 메모 목록");
  const panel = page.locator("dialog.panel[open]", { hasText: "작업 메모 목록" });
  await expect(panel.getByText("안 끝냄 1 / 전체 1")).toBeVisible();
  await expect(panel.getByText("여기부터 다시 확인")).toBeVisible();
  await panel.getByRole("checkbox", { name: "끝냄" }).check();
  await expect(panel.getByText("안 끝냄 0 / 전체 1")).toBeVisible();
  await page.screenshot({ path: process.env.MEMO_SHOT ?? "test-results/memo.png" });

  // 끝냄 → 넣기 순서로 한 칸씩 돌아간다
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect(panel.getByText("안 끝냄 1 / 전체 1")).toBeVisible();
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect(panel.getByText("작업 메모가 없습니다", { exact: false })).toBeVisible();
});
