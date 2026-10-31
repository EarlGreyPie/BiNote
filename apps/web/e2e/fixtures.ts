import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";

/**
 * 화면 연기 시험이 함께 쓰는 준비와 손동작.
 * - 시험마다 새 브라우저 문맥이라 자동 보존·설정이 비어 있는 첫 방문으로 시작한다.
 * - 콘솔 오류와 잡히지 않은 예외를 모아, 시험이 끝날 때 하나라도 있으면 실패로 친다.
 * - 클립보드 쓰기는 가로채 적어 둔다. 내보내기 창은 MML@ 글을 화면에 보이지 않고 클립보드로만 보내기 때문이다
 *   (운영체제 클립보드는 병렬로 도는 시험끼리 섞일 수 있어 쓰지 않는다).
 * - 파일 저장·열기 창(showSaveFilePicker 등)은 브라우저 바깥 창이라 시험에서 누를 수 없다. 그 함수를 지워
 *   그런 창이 없는 브라우저처럼 다운로드로 저장하고 파일 고르기(<input type=file>)로 열게 한다
 */

declare global {
  interface Window {
    /** 앱이 클립보드에 쓴 글 (차례대로) */
    __copied: string[];
  }
}

/** 시험에 쓰는 짧은 MML@ 글: 연주자 하나, 트랙 둘 (가락 + 화음) */
export const SAMPLE_MML = "MML@t120l8cdefgab>c,o3l2ceg;";

/** 앱 문서가 뜨기 전에 넣는 준비: 바깥 창 함수 지우기, 클립보드 가로채기 */
function prepareWindow(): void {
  const w = window as unknown as Record<string, unknown>;
  delete w.showSaveFilePicker;
  delete w.showOpenFilePicker;
  delete w.showDirectoryPicker;
  window.__copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        window.__copied.push(text);
      },
      readText: async () => window.__copied.at(-1) ?? "",
    },
  });
}

/** 브라우저 문맥에 시험 준비를 건다. 시험 안에서 새 문맥을 만들 때도 쓴다 */
export async function prepareContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(prepareWindow);
}

/** 페이지의 콘솔 오류와 잡히지 않은 예외를 모은다 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export const test = base.extend<{ consoleErrors: string[] }>({
  context: async ({ context }, use) => {
    await prepareContext(context);
    await use(context);
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors = watchErrors(page);
      await use(errors);
      expect(errors, "콘솔 오류가 없어야 한다").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** 앱을 열고 첫 화면(곡 없음)이 다 뜰 때까지 기다린다 */
export async function openApp(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "새 악보", exact: true })).toBeVisible();
}

/** 붙여넣기 창에 MML@ 글을 넣고 새 곡으로 연다 */
export async function pasteAsNewSong(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "MML@ 붙여넣기" }).first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("textarea").fill(text);
  const open = dialog.getByRole("button", { name: "새 곡으로 열기" });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(dialog).toHaveCount(0);
}

/** 트랙 줄의 트랙 단추들 */
export function trackTabs(page: Page): Locator {
  return page.getByRole("tab");
}

/** 지금 트랙 편집기(CodeMirror)의 MML 원문 */
export function trackEditor(page: Page): Locator {
  return page.locator(".cm-content").first();
}

/** 지금 트랙의 음 수 표시 ("음 8개") */
export function noteCount(page: Page): Locator {
  return page.getByText(/^음 \d+개$/).first();
}

/** 위 띠 메뉴(파일·편집…)를 열고 항목을 누른다 */
export async function menu(page: Page, top: string, item: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/**
 * 내보내기 창을 열어 모든 악보의 트랙을 골라 복사하고, 복사된 MML@ 글을 돌려준다.
 * 창은 이미 복사한 트랙을 빼고 미리 고르므로, 악보 체크를 모두 켜서 늘 곡 전체를 복사한다
 */
export async function exportMml(page: Page): Promise<string> {
  const before = await page.evaluate(() => window.__copied.length);
  await menu(page, "파일", /MML로 내보내기/);
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "MML로 내보내기" })).toBeVisible();
  const scores = dialog.getByRole("checkbox", { name: /^악보\d+$/ });
  await expect(scores.first()).toBeVisible();
  for (const box of await scores.all()) await box.check();
  await dialog.getByRole("button", { name: "고른 트랙 복사" }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(before + 1);
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toHaveCount(0);
  return page.evaluate(() => window.__copied.at(-1)!);
}

/** 글 칸·단추에서 초점을 빼, 단축키가 롤로 가게 한다 (단추에 초점이 있으면 앱이 단축키를 받지 않는다) */
export async function focusRoll(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
