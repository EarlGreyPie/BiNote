import { expect, openApp, test } from "./fixtures";

// 앱이 오류 없이 뜨는지 (콘솔 오류는 fixtures가 시험 끝에 따로 본다)

test("첫 화면이 뜨고 위 띠 메뉴가 열린다", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("heading", { name: "BINOTE" })).toBeVisible();
  await expect(page.getByText(/악보가 없습니다/)).toBeVisible();
  // 첫 방문이라 지난 작업 목록은 없다
  await expect(page.getByRole("heading", { name: "지난 작업" })).toHaveCount(0);

  // 파일 메뉴를 열고 Esc로 닫는다
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "새 악보" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "새 악보" })).toHaveCount(0);
});

test("새 악보를 만들면 트랙 하나와 롤이 생긴다", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "새 악보", exact: true }).click();
  await expect(page.getByTestId("piano-roll")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByText(/악보가 없습니다/)).toHaveCount(0);
});
