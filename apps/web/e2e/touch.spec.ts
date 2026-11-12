import type { BrowserContext, Page } from "@playwright/test";
import { expect, noteCount, openApp, pasteAsNewSong, SAMPLE_MML, test } from "./fixtures";

// 타브를 손가락으로 쓸 때: 숫자판을 여는 누르기와 두 손가락 확대

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  // 터치 화면은 트랙 띠 대신 구조 목록을 보여 주므로 편집기의 음 수로 곡이 열린 것을 본다
  await expect(noteCount(page)).toHaveText("음 8개");
  await page.getByRole("button", { name: "타브", exact: true }).tap();
});

/** 손가락으로 잠깐(90ms) 눌렀다 뗀다. 누르는 동안 화면이 다시 그려지는 실제 누르기처럼 */
async function press(page: Page, context: BrowserContext, x: number, y: number): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await page.waitForTimeout(90);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("타브 줄을 손가락으로 눌러 숫자판을 열면 그 누르기가 숫자판 단추까지 누르지 않는다", async ({ page, context }) => {
  const canvas = page.locator(".tab .canvas-wrap > canvas");
  const pad = page.locator(".tab .pad");
  const scroll = page.locator(".tab .tools input.scroll");
  const start = await scroll.inputValue();
  // 숫자판이나 그 위 시간 스크롤 줄에 떨어진 click을 센다
  await page.evaluate(() => {
    const w = window as unknown as { padClicks: number };
    w.padClicks = 0;
    document.addEventListener("click", (e) => (e.target as Element).closest?.(".tab .pad, .tab .tools") && w.padClicks++, true);
  });
  const padClicks = () => page.evaluate(() => (window as unknown as { padClicks: number }).padClicks);
  // 지판 위치(위·가운데·아래)마다 줄 여러 곳을 눌러 본다. 숫자판이 뜨면 지판이 위로 밀려, 누른 자리에 숫자판 단추가 온다.
  // 전에는 누른 자리에 따라 그 칸의 음이 지워지거나, 숫자판이 곧바로 닫히거나, 시간 스크롤이 건너뛰었다
  for (let round = 0; round < 3; round++) {
    for (const fy of [0.5, 0.92]) {
      for (const fx of [0.12, 0.3, 0.5, 0.7, 0.9]) {
        const box = (await canvas.boundingBox())!;
        await press(page, context, box.x + box.width * fx, box.y + box.height * fy);
        await expect(pad).toBeVisible();
        // 누르기에 딸려 오는 click까지 지나가게
        await page.waitForTimeout(120);
        await expect(pad).toBeVisible();
        expect(await padClicks()).toBe(0);
        await expect(noteCount(page)).toHaveText("음 8개");
        await expect(scroll).toHaveValue(start);
        await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
        await pad.getByRole("button", { name: "숫자판 닫기" }).tap();
        await expect(pad).toBeHidden();
        await page.evaluate(() => ((window as unknown as { padClicks: number }).padClicks = 0));
      }
    }
    // 지판 위치를 다음 것으로 (아래 도구 띠의 단추)
    await page.locator(".tab .tools button.tab-align").tap();
    await page.evaluate(() => ((window as unknown as { padClicks: number }).padClicks = 0));
  }

  // 숫자판을 연 바로 뒤에 누르는 숫자 단추는 받는다
  const box = (await canvas.boundingBox())!;
  await press(page, context, box.x + box.width * 0.6, box.y + box.height * 0.5);
  await pad.locator(".frets button", { hasText: /^5$/ }).first().tap();
  await expect(noteCount(page)).toHaveText("음 9개");
});

test("타브에서 두 손가락으로 확대해도 커서가 찍히거나 숫자판이 열리지 않는다", async ({ page, context }) => {
  const canvas = page.locator(".tab .canvas-wrap > canvas");
  const pad = page.locator(".tab .pad");
  const scroll = page.locator(".tab .tools input.scroll");
  const box = (await canvas.boundingBox())!;
  const maxBefore = Number(await scroll.getAttribute("max"));
  // 숫자판이 뜨면 지판이 밀려 올라가는 아래쪽 줄에서 집는다 (전에는 둘째 손가락이 지판을 벗어나 확대도 되지 않았다)
  const y = box.y + box.height * 0.9;
  const x1 = box.x + box.width * 0.45;
  const x2 = box.x + box.width * 0.55;
  const cdp = await context.newCDPSession(page);
  const finger = (id: number, x: number) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, x1)] });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, x1), finger(2, x2)] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, x1 - i * 12), finger(2, x2 + i * 12)] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);

  await expect(pad).toBeHidden();
  // 벌렸으니 시간이 확대되어 굴릴 수 있는 범위가 달라진다
  expect(Number(await scroll.getAttribute("max"))).not.toBe(maxBefore);
  await expect(noteCount(page)).toHaveText("음 8개");
});
