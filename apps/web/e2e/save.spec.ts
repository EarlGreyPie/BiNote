import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, exportMml, focusRoll, menu, openApp, pasteAsNewSong, prepareContext, SAMPLE_MML, test, trackEditor, trackTabs, watchErrors } from "./fixtures";

// .mme 저장·열기 왕복과 새로고침 뒤 자동 보존 되살리기

/** 붙여넣은 곡의 첫 트랙을 한 옥타브 올린다 (연 그대로의 곡은 자동 보존하지 않으므로 한 번 고친다) */
async function pasteAndEdit(page: Page): Promise<string> {
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  await expect(trackTabs(page)).toHaveCount(2);
  await focusRoll(page);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(trackEditor(page)).toHaveText("l8t120>cdefgab>c");
  const text = await exportMml(page);
  expect(text).toBe("MML@l8>cdefgab>c,l2<ceg;");
  return text;
}

test(".mme로 저장한 파일을 새 창에서 열면 같은 곡이 된다", async ({ page, browser, baseURL, locale, timezoneId, viewport }, testInfo) => {
  const edited = await pasteAndEdit(page);

  // 저장 창이 없는 브라우저처럼 다운로드로 저장된다
  const download = page.waitForEvent("download");
  await menu(page, "파일", /프로젝트로 저장/);
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mme$/);
  // 시험 이름(한국어)이 든 결과 폴더 경로는 파일 고르기에 바로 넘기면 읽히지 않을 때가 있어, 내용(버퍼)으로 넘긴다
  const path = testInfo.outputPath("saved.mme");
  await file.saveAs(path);
  const bytes = readFileSync(path);
  const project = JSON.parse(bytes.toString("utf8")) as { format: string; song: { tracks: unknown[] } };
  expect(project.format).toBe("mmlce");
  expect(project.song.tracks).toHaveLength(2);

  // 자동 보존이 없는 새 문맥(새 브라우저 프로필)에서 파일로 연다
  // 설정 파일의 baseURL·언어·시간대·화면 크기를 그대로 쓴다 (값이 없으면 넘기지 않는다)
  const other = await browser.newContext({
    viewport,
    ...(baseURL !== undefined && { baseURL }),
    ...(locale !== undefined && { locale }),
    ...(timezoneId !== undefined && { timezoneId }),
  });
  try {
    await prepareContext(other);
    const fresh = await other.newPage();
    const errors = watchErrors(fresh);
    await openApp(fresh);
    const chooser = fresh.waitForEvent("filechooser");
    await fresh.getByRole("button", { name: "악보 열기", exact: true }).click();
    await (await chooser).setFiles({ name: file.suggestedFilename(), mimeType: "application/json", buffer: bytes });
    await expect(trackTabs(fresh)).toHaveCount(2);
    await expect(trackEditor(fresh)).toHaveText("l8t120>cdefgab>c");
    expect(await exportMml(fresh)).toBe(edited);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("새로고침 뒤 지난 작업에서 고치던 곡을 되살린다", async ({ page }) => {
  const edited = await pasteAndEdit(page);

  // 고친 뒤 잠시 쉬면 자동 보존이 이 브라우저(IndexedDB)에 적는다. 적힐 때까지 기다린다
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("mmlce-work");
              req.onerror = () => resolve(0);
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("works")) {
                  db.close();
                  resolve(0);
                  return;
                }
                const count = db.transaction("works").objectStore("works").count();
                count.onsuccess = () => {
                  db.close();
                  resolve(count.result);
                };
                count.onerror = () => {
                  db.close();
                  resolve(0);
                };
              }
            }),
        ),
      { timeout: 15_000 },
    )
    .toBe(1);

  await page.reload();
  await expect(page.getByText(/악보가 없습니다/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "지난 작업" })).toBeVisible();
  await expect(page.getByText(/트랙 2 · 음 11/)).toBeVisible();
  await page.getByRole("button", { name: "되살리기" }).click();

  await expect(trackTabs(page)).toHaveCount(2);
  await expect(trackEditor(page)).toHaveText("l8t120>cdefgab>c");
  expect(await exportMml(page)).toBe(edited);
  // 되살린 곡도 실행 취소 기록은 새로 시작한다
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
});

test("마비꼬로 저장 창에서 뺀 트랙은 .mmi에 들어가지 않는다", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  await expect(trackTabs(page)).toHaveCount(2);
  await menu(page, "파일", /다른 형식으로 저장/);
  await page.getByRole("menuitem", { name: /마비꼬로 저장/ }).click();
  const dialog = page.locator("dialog[open]").filter({ hasText: "마비꼬(.mmi)로 저장" });
  await expect(dialog).toBeVisible();
  // 미리보기: 피아노 트랙 둘이 마비꼬 트랙 하나(멜로디·화음1)로 묶인다
  await expect(dialog.getByText("마비꼬 트랙 1개로 저장")).toBeVisible();
  await dialog.locator("fieldset input[type=checkbox]").nth(1).uncheck();
  await page.screenshot({ path: testInfo.outputPath("mmi-dialog.png") });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "마비꼬로 저장" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mmi$/);
  const path = testInfo.outputPath("saved.mmi");
  await file.saveAs(path);
  const text = readFileSync(path, "utf8");
  expect(text.match(/^mml-track=.*$/gm)).toEqual(["mml-track=MML@t120l8cdefgab>c,,;"]);
  expect(errors).toEqual([]);
});

test("마비꼬로 저장 직접 묶기: 마비꼬 트랙을 더해 트랙을 나눠 넣는다", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await openApp(page);
  await pasteAsNewSong(page, SAMPLE_MML);
  await menu(page, "파일", /다른 형식으로 저장/);
  await page.getByRole("menuitem", { name: /마비꼬로 저장/ }).click();
  const dialog = page.locator("dialog[open]").filter({ hasText: "마비꼬(.mmi)로 저장" });
  await dialog.getByLabel("직접 묶기").check();
  await dialog.getByRole("button", { name: "마비꼬 트랙 더하기" }).click();
  await dialog.getByRole("combobox", { name: "연주자 1-2 넣을 곳" }).selectOption({ label: "트랙 2" });
  await dialog.getByRole("textbox", { name: "마비꼬 트랙 이름" }).nth(1).fill("반주");
  await expect(dialog.getByText("마비꼬 트랙 2개로 저장")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mmi-manual.png") });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "마비꼬로 저장" }).click();
  const path = testInfo.outputPath("manual.mmi");
  await (await download).saveAs(path);
  const text = readFileSync(path, "utf8");
  expect(text.match(/^mml-track=.*$/gm)).toEqual(["mml-track=MML@t120l8cdefgab>c,,;", "mml-track=MML@o3l2ceg,,;"]);
  expect(text).toContain("name=반주\n");
  expect(errors).toEqual([]);
});

test("마비꼬 가져오기 창: 마비꼬 트랙 둘을 악보 하나로 모아 연다", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await openApp(page);
  const mmi = ["[mml-score]", "tempo=0T120", "mml-track=MML@t120c4,e4,g4;", "name=악보 1 1", "program=21", "mml-track=MML@c1,,;", "name=악보 1 2", "program=0"].join("\n");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "악보 열기", exact: true }).click();
  await (await chooser).setFiles({ name: "둘.mmi", mimeType: "text/plain", buffer: Buffer.from(mmi) });
  const dialog = page.locator("dialog[open]").filter({ hasText: "마비꼬(.mmi) 가져오기" });
  await expect(dialog.getByText("BiNote 악보 1개로 열기")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mmi-import.png") });
  await dialog.getByRole("button", { name: "열기", exact: true }).click();
  await expect(trackTabs(page)).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("마비꼬 가져오기 창: 어긋난 길이가 있는 마비꼬 트랙에 수를 미리 보여 주고, 열면 어긋난 길이 창이 뜬다", async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page);
  const mmi = ["[mml-score]", "tempo=0T120", "mml-track=MML@l64d+e21g8c4,,;", "name=꼬임", "program=0", "mml-track=MML@c1,,;", "name=반듯", "program=0"].join("\n");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "악보 열기", exact: true }).click();
  await (await chooser).setFiles({ name: "꼬임.mmi", mimeType: "text/plain", buffer: Buffer.from(mmi) });
  const dialog = page.locator("dialog[open]").filter({ hasText: "마비꼬(.mmi) 가져오기" });
  await expect(dialog.locator("li").filter({ hasText: "꼬임" }).getByText("어긋난 길이 1곳")).toBeVisible();
  await expect(dialog.locator("li").filter({ hasText: "반듯" }).getByText(/어긋난 길이/)).toHaveCount(0);
  await expect(dialog.getByText("어긋난 길이가 1곳 있습니다.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "열기", exact: true }).click();
  await expect(page.locator("dialog[open]").filter({ hasText: "어긋난 길이 찾기" })).toBeVisible();
  expect(errors).toEqual([]);
});
