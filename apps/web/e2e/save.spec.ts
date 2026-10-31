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
