import { expect, menu, openApp, pasteAsNewSong, SAMPLE_MML, test, trackTabs } from "./fixtures";

// MML로 내보내기 창의 붙여넣는 순서: 기본은 곡 순서, ▲ ▼로 직접 옮겼을 때만 바뀐다 (rc.4)

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  await expect(trackTabs(page)).toHaveCount(2);
});

test("체크를 껐다 켜도 곡 순서이고, ▼로 옮기면 직접 정한 순서대로 복사된다", async ({ page }) => {
  await menu(page, "파일", /MML로 내보내기/);
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "MML로 내보내기" })).toBeVisible();
  const tracks = dialog.locator(".track");
  const names = await tracks.locator("button.name").allTextContents();
  expect(names).toHaveLength(2);
  const order = dialog.getByRole("list", { name: "붙여넣는 순서" }).getByRole("listitem");

  // 처음엔 둘 다 미리 체크, 곡 순서. 고르는 목록에도 칸 번호가 붙는다
  await expect(order).toHaveCount(2);
  await expect(order.nth(0)).toContainText(names[0]!);
  await expect(order.nth(0)).toContainText("악보1");
  await expect(tracks.nth(0).locator(".slot")).toHaveText("1");
  await expect(tracks.nth(1).locator(".slot")).toHaveText("2");

  // 첫 트랙을 껐다 켜도 맨 뒤로 가지 않는다 (전에는 2번 칸으로 갔다)
  await tracks.nth(0).getByRole("checkbox").uncheck();
  await expect(order).toHaveCount(0);
  await tracks.nth(0).getByRole("checkbox").check();
  await expect(order.nth(0)).toContainText(names[0]!);
  await expect(order.nth(1)).toContainText(names[1]!);
  await expect(dialog.getByText("직접 정한 순서")).toHaveCount(0);

  // ▼로 옮기면 직접 정한 순서. 초점은 같은 줄(이제 2번 칸)의 ▲로 남는다
  await order.nth(0).getByRole("button", { name: /뒤 칸으로/ }).click();
  await expect(dialog.getByText("직접 정한 순서")).toBeVisible();
  await expect(order.nth(0)).toContainText(names[1]!);
  await expect(order.nth(1).getByRole("button", { name: /앞 칸으로/ })).toBeFocused();
  await expect(tracks.nth(0).locator(".slot")).toHaveText("2");

  // 복사한 글의 칸 차례가 목록과 같다
  const before = await page.evaluate(() => window.__copied.length);
  await dialog.getByRole("button", { name: "고른 트랙 복사" }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(before + 1);
  expect(await page.evaluate(() => window.__copied.at(-1))).toBe("MML@l2<ceg,l8cdefgab>c;");
});

test("곡 순서로를 누르면 곡 순서로 돌아간다", async ({ page }) => {
  await menu(page, "파일", /MML로 내보내기/);
  const dialog = page.locator("dialog[open]");
  const order = dialog.getByRole("list", { name: "붙여넣는 순서" }).getByRole("listitem");
  const first = (await order.nth(0).textContent())!;
  await order.nth(1).getByRole("button", { name: /앞 칸으로/ }).click();
  await expect(dialog.getByText("직접 정한 순서")).toBeVisible();
  await dialog.getByRole("button", { name: "곡 순서로" }).click();
  await expect(dialog.getByText("직접 정한 순서")).toHaveCount(0);
  await expect(order.nth(0)).toHaveText(first);
  await dialog.getByRole("button", { name: "고른 트랙 복사" }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toBe("MML@l8cdefgab>c,l2<ceg;");
});
