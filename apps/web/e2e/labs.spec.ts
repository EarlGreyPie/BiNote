import type { Page } from "@playwright/test";
import { expect, openApp, pasteAsNewSong, test, trackTabs } from "./fixtures";

// 실험실 연주 누락음 검사: 켰을 때만 곡 검사에 보이고, 고치기 창에서 고친 뒤 실행 취소 한 번으로 되돌아간다

/** 게임 녹음으로 빠짐을 확인한 시험 판 (dev docs/NOTE_DROP_RESEARCH.md 6.6절 A판, 한 악보 6트랙 피아노) */
const A =
  "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6v9e24f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";

/** 상태줄의 "검사 N" 단추 */
const checksButton = (page: Page) => page.getByRole("button", { name: /^검사 \d+$/ });

/** 상태줄의 "검사 N" 단추를 눌러 곡 검사 칸을 연다 */
async function openChecks(page: Page) {
  await checksButton(page).click();
  await expect(page.getByText("곡 검사")).toBeVisible();
}

test("실험실을 끄면 연주 누락음 검사이 곡 검사에 없다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, A);
  await expect(trackTabs(page)).toHaveCount(6);
  // 이 곡에는 곡 검사 목록에 남는 다른 검사가 없어 검사 단추도 없다 (접히는 o1b는 편집기 밑줄)
  await expect(checksButton(page)).toHaveCount(0);
});

test("실험실을 켜면 연주 누락음 검사이 보이고, 모두 고치면 사라지며 실행 취소로 돌아온다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mmlce.labs", "1"));
  await openApp(page);
  await pasteAsNewSong(page, A);
  await expect(trackTabs(page)).toHaveCount(6);
  await openChecks(page);
  const line = page.locator(".checks li", { hasText: "연주 누락음 위험(실측 전)" });
  await expect(line).toHaveCount(1);
  await expect(line.getByText("실측 전", { exact: true })).toBeVisible();
  // 자리 단추 (착지 음은 곡 처음부터 온음표 3/4 = 1마디 4박)
  await expect(line.getByRole("button", { name: "1마디 4박" })).toBeVisible();

  await line.getByRole("button", { name: "연주 누락음 고치기…" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: /연주 누락음 고치기/ })).toBeVisible();
  await expect(dialog.getByText("1곳", { exact: true })).toBeVisible();
  // 같은 구간의 착지 음 C4·G3 두 개, 미리 보기에 늦출 음 수와 늘어나는 글자 수
  await expect(dialog.getByText(/늦출 음 2개 · 글자 수 약 \d+자 늘어남/)).toBeVisible();
  await expect(dialog.getByText("r64.만큼(48ms) 늦춤")).toBeVisible();
  await dialog.getByRole("button", { name: "모두 고치기 (1곳)" }).click();
  await expect(dialog.getByText("연주 누락음 위험 자리가 없습니다.")).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toHaveCount(0);

  // 고친 뒤 검사에서 사라지고(남는 검사가 없어 검사 단추도 없다), 실행 취소 한 번이면 다시 나온다
  await expect(checksButton(page)).toHaveCount(0);
  await page.getByRole("button", { name: "실행 취소" }).click();
  await openChecks(page);
  await expect(page.locator(".checks li", { hasText: "연주 누락음 위험(실측 전)" })).toHaveCount(1);
});
