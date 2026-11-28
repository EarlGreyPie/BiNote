import { expect, menu, openApp, pasteAsNewSong, test } from "./fixtures";

// 붙여넣는 순서 목록: 손잡이를 끌어 칸을 한 번에 바꾼다 (rc.5)

test.describe("손가락으로 끌기", () => {
  test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });
  test("끄는 줄이 자리를 바꿔도 손가락을 놓치지 않고, 맨 아래까지 끌면 맨 아래 칸에 놓인다", async ({ page }) => {
    await openApp(page);
    await pasteAsNewSong(page, "MML@cdef,efga,gab>c,c1;");
    await menu(page, "파일", /MML로 내보내기/);
    const dialog = page.locator("dialog[open]");
    const rows = dialog.getByRole("list", { name: "붙여넣는 순서" }).locator("li[data-id]");
    await expect(rows).toHaveCount(4);
    const first = await rows.nth(0).getAttribute("data-id");
    const grip = (await rows.nth(0).locator(".grip").boundingBox())!;
    // 손가락으로 잡기 쉬운 크기
    expect(grip.width).toBeGreaterThanOrEqual(24);
    const last = (await rows.nth(3).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = grip.x + grip.width / 2;
    const y0 = grip.y + grip.height / 2;
    const y1 = last.y + last.height - 4;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 10 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(rows.nth(3)).toHaveAttribute("data-id", first!);
    await expect(dialog.getByText("직접 정한 순서")).toBeVisible();
  });
});

test("마우스로 맨 아래 줄을 맨 위로 끌면 한 번에 1번 칸이 되고, 복사한 글도 그 차례다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@cdef,efga,gab>c;");
  await menu(page, "파일", /MML로 내보내기/);
  const dialog = page.locator("dialog[open]");
  const rows = dialog.getByRole("list", { name: "붙여넣는 순서" }).locator("li[data-id]");
  await expect(rows).toHaveCount(3);
  const last = await rows.nth(2).getAttribute("data-id");
  const grip = (await rows.nth(2).locator(".grip").boundingBox())!;
  const top = (await rows.nth(0).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, top.y + 2, { steps: 8 });
  await page.mouse.up();
  await expect(rows.nth(0)).toHaveAttribute("data-id", last!);
  await expect(dialog.getByText("직접 정한 순서")).toBeVisible();
  await dialog.getByRole("button", { name: "고른 트랙 복사" }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toMatch(/^MML@(l4)?gab>c,/);
});
