import type { Page } from "@playwright/test";
import { expect, focusRoll, menu, openApp, pasteAsNewSong, test, trackTabs } from "./fixtures";

// 곡은 뒤쪽 계산(워커)으로 그대로 넘길 수 있어야 한다. 화면 상태(Proxy)가 곡에 섞이면 넘기지 못해
// 악보책 나눌 자리 보기가 뜨지 않고 악보책 나누기 창이 끝나지 않았다 (진단 정보의 DataCloneError)

declare global {
  interface Window {
    /** 곡을 워커로 넘긴 횟수 */
    __songPosts: number;
    /** 워커로 넘기다 난 오류 */
    __postFails: string[];
  }
}

/** 화음이 있는 세 트랙 */
const CHORDS = "MML@t120l4cdefgab>c<cdefgab>c,l4egab>cde<egab>cdee,l4gab>cdefg<gab>cdefg;";

/** 워커로 보내는 요청을 세고, 넘기지 못한 것을 적는다 (다시 보내 성공한 경우도 처음 실패는 남는다) */
function watchWorkerPosts(): void {
  const post = Worker.prototype.postMessage as (this: Worker, message: unknown, ...rest: unknown[]) => void;
  window.__songPosts = 0;
  window.__postFails = [];
  Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
    try {
      post.call(this, message, ...rest);
    } catch (error) {
      window.__postFails.push(String(error));
      throw error;
    }
    if ((message as { request?: { song?: unknown } } | undefined)?.request?.song) window.__songPosts++;
  } as Worker["postMessage"];
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(watchWorkerPosts);
  await openApp(page);
});

/** 지금까지 곡을 넘긴 횟수 */
const posts = (page: Page) => page.evaluate(() => window.__songPosts);

/** 손동작 뒤에 곡이 워커로 다시 넘어가고(나눌 자리 보기), 넘기다 난 오류가 없는지 본다 */
async function sendsSong(page: Page, act: () => Promise<void>): Promise<void> {
  const before = await posts(page);
  await act();
  await expect.poll(() => posts(page)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.__postFails)).toEqual([]);
}

/** 나눌 자리 보기를 켠다 (곡이 바뀔 때마다 곡을 워커로 넘긴다) */
async function showSplitPreview(page: Page): Promise<void> {
  await sendsSong(page, () => menu(page, "보기", /악보책 나눌 자리 보기/));
}

/** 첫 트랙의 음을 모두 고른다 */
async function selectFirstTrack(page: Page): Promise<void> {
  await trackTabs(page).first().click();
  await page.keyboard.press("Control+A");
}

test("음을 복사해 붙이거나 템포·마커를 넣은 곡도 워커로 넘어가고, 악보책 나누기 창이 끝난다", async ({ page }) => {
  await pasteAsNewSong(page, CHORDS);
  await showSplitPreview(page);

  await sendsSong(page, async () => {
    await selectFirstTrack(page);
    await page.keyboard.press("Control+C");
    await focusRoll(page);
    await page.keyboard.press("End");
    await trackTabs(page).first().click();
    await page.keyboard.press("Control+V");
  });
  // 되돌렸다 다시 해도 (다시 하기는 붙였던 음을 그대로 되살린다)
  await sendsSong(page, async () => {
    await focusRoll(page);
    await page.keyboard.press("Control+Z");
  });
  await sendsSong(page, () => page.keyboard.press("Control+Y"));

  const dialog = page.locator("dialog[open]");
  await sendsSong(page, async () => {
    await focusRoll(page);
    await page.keyboard.press("Alt+B");
    await dialog.locator("input.num").first().fill("150");
    await dialog.getByRole("button", { name: "적용" }).click();
  });
  await sendsSong(page, async () => {
    await focusRoll(page);
    await page.keyboard.press("Alt+M");
    await dialog.locator("input.text").fill("A");
    await dialog.getByRole("button", { name: "적용" }).click();
  });

  // 악보책 나누기 창도 "계산하는 중"에서 멈추지 않고 결과를 보인다
  await page.getByRole("button", { name: "곡", exact: true }).click();
  await page.getByRole("menuitem", { name: /^글자 수 맞추기/ }).first().click();
  await page.getByRole("menuitem", { name: /^악보책 나누기/ }).first().click();
  await expect(dialog.getByText(/\d+권으로 나눴어요|나눌 필요가 없어요|한 권에 들어가요/).first()).toBeVisible();
  expect(await page.evaluate(() => window.__postFails)).toEqual([]);
});

test("슬라이드를 만든 곡도 워커로 넘어간다", async ({ page }) => {
  await pasteAsNewSong(page, CHORDS);
  await showSplitPreview(page);
  await sendsSong(page, async () => {
    await selectFirstTrack(page);
    await menu(page, "편집", /^슬라이드/);
    await page.locator("dialog[open] button.primary").first().click();
  });
});

test("꾸밈음을 넣은 곡도 워커로 넘어간다", async ({ page }) => {
  await pasteAsNewSong(page, CHORDS);
  await showSplitPreview(page);
  await sendsSong(page, async () => {
    await selectFirstTrack(page);
    await menu(page, "편집", /^꾸밈음 넣기/);
    await page.locator("dialog[open] button.primary").first().click();
  });
});

test("마비꼬(.mmi) 가져오기 창으로 연 곡도 워커로 넘어간다", async ({ page }) => {
  const mmi = ["[mml-score]", "tempo=0T120", "mml-track=MML@t120c4,e4,g4;", "name=악보 1 1", "program=21", "mml-track=MML@c1,,;", "name=악보 1 2", "program=0"].join("\n");
  await page.locator("input[type=file]").first().setInputFiles({ name: "둘.mmi", mimeType: "text/plain", buffer: Buffer.from(mmi) });
  const dialog = page.locator("dialog[open]").filter({ hasText: "마비꼬(.mmi) 가져오기" });
  await dialog.getByRole("button", { name: "열기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await showSplitPreview(page);
});
