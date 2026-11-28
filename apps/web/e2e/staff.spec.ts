import { expect, openApp, pasteAsNewSong, SAMPLE_MML, test } from "./fixtures";

// 실험실 오선보 보기: 피아노롤·타브와 나란한 세 번째 보기. 보기만 하고, 음 편집 키는 곡을 바꾸지 않는다

test("실험실이 꺼져 있으면 오선보 보기 단추가 없다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  await expect(page.locator(".toolbar .seg").first().getByRole("button", { name: "오선보" })).toHaveCount(0);
});

test("오선보 보기로 바꾸면 편집 칸 전체에 오선보가 그려지고, 음 편집 키는 곡을 바꾸지 않으며, 음을 누르면 피아노롤로 간다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mmlce.labs", "1"));
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  const views = page.locator(".toolbar .seg").first();
  await views.getByRole("button", { name: "오선보" }).click();
  const staff = page.locator("section.staff.full");
  await expect(staff).toBeVisible();
  // VexFlow를 불러와 SVG 조각을 그린다
  await expect(staff.locator(".chunk svg").first()).toBeVisible({ timeout: 20_000 });
  // 피아노롤은 사라지고, 위 칸 오선보(닫기 단추 있는 것)는 없다
  await expect(page.locator("section.staff:not(.full)")).toHaveCount(0);

  // 음 편집 키: 실행 취소 단추가 그대로 꺼져 있다 (곡을 바꾸지 않았다) + 안내
  const undo = page.getByRole("button", { name: "실행 취소" });
  await expect(undo).toBeDisabled();
  // 보기 단추에 초점이 남으면 단축키를 받지 않으므로(지금 앱 규칙) 오선보 머리를 눌러 초점을 뺀다
  await staff.locator("header strong").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(undo).toBeDisabled();
  await expect(page.getByText("오선보에서는 음을 고칠 수 없습니다", { exact: false }).first()).toBeVisible();

  // 음표를 누르면 피아노롤로 바뀐다
  const note = staff.locator(".chunk svg .vf-stavenote").first();
  await note.click();
  await expect(page.locator("section.staff.full")).toHaveCount(0);
  await expect(views.getByRole("button", { name: "피아노롤" })).toHaveClass(/on/);
});

test("오선보 보기는 칸 폭에서 악보처럼 줄을 바꿔 세로로 넘기고, 빈 곳을 누르면 그 줄의 그 자리로 커서를 옮긴다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mmlce.labs", "1"));
  await page.setViewportSize({ width: 1000, height: 760 });
  await openApp(page);
  // 32마디 (8분음표 8개씩) + 아래 트랙
  await pasteAsNewSong(page, `MML@t120l8${"cdefgab>c<".repeat(32)},o3l1${"c".repeat(32)};`);
  await page.locator(".toolbar .seg").first().getByRole("button", { name: "오선보" }).click();
  const staff = page.locator("section.staff.full");
  await expect(staff.locator(".system .chunk svg").first()).toBeVisible({ timeout: 20_000 });
  const scroller = staff.locator(".scroller");
  // 가로로 넘치지 않고 세로로 넘친다 (여러 줄)
  const size = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(size.sw).toBeLessThanOrEqual(size.cw + 1);
  expect(size.sh).toBeGreaterThan(size.ch);
  // 줄마다 음자리표 칸이 있고, 보이는 줄만 그린다 (32마디를 다 그리지 않는다)
  const drawn = await staff.locator(".system").count();
  expect(drawn).toBeGreaterThan(1);
  expect(await staff.locator(".system .system-gutter svg").count()).toBe(drawn);
  const firstLine = await staff.locator(".system").first().evaluate((el) => el.querySelectorAll(".vf-stavenote").length);
  expect(firstLine).toBeGreaterThan(0);

  // 맨 아래로 넘기면 마지막 줄을 그린다 (마지막 마디 번호 32)
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(staff.locator(".system svg text", { hasText: /^32$/ })).toHaveCount(1);

  // 둘째 줄의 빈 곳(맨 위 템포 자리)을 누르면 커서가 둘째 줄로 간다
  await scroller.evaluate((el) => (el.scrollTop = 0));
  const second = staff.locator(".system").nth(1);
  await expect(second.locator(".chunk svg")).toBeVisible();
  const box = (await second.boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 6);
  const cursor = staff.locator(".line.cursor");
  await expect(cursor).toBeVisible();
  const top = await cursor.evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const secondTop = await second.evaluate((el) => parseFloat((el as HTMLElement).style.top));
  expect(top).toBe(secondTop);
  await page.screenshot({ path: process.env.STAFF_SHOT ?? test.info().outputPath("staff-wrap.png") });
});
