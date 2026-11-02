import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, menu, openApp, pasteAsNewSong, test } from "./fixtures";

// 배경 영상: 속도 자동 재기 뒤 롤 따라가기, 곡을 바꿔도 이어지는 영상의 맞춤값

/**
 * 합성한 떨어지는 무늬 영상 (256×144, 10fps, 6초, 1초에 40px씩 내려온다). 실제 연주 영상이 아니다.
 * 만든 명령: ffmpeg -f lavfi -i "nullsrc=s=256x144:r=10:d=6,format=gray,geq=lum='255*gt(sin((Y-T*40)/6+sin((Y-T*40)/17)*2)*sin(X/9+(Y-T*40)/23),0.35)'" -c:v libvpx -crf 30 -b:v 80k -pix_fmt yuv420p falling-notes.webm
 */
const FALLING = fileURLToPath(new URL("./assets/falling-notes.webm", import.meta.url));
/** 같은 무늬가 1초에 90px씩 내려오는 영상 (위 명령에서 T*40을 T*90으로) */
const FAST = fileURLToPath(new URL("./assets/falling-notes-fast.webm", import.meta.url));

/** 짧은 사인파 원곡 (1초, 8kHz) */
const TONE = fileURLToPath(new URL("./assets/tone.wav", import.meta.url));

/** 원곡 고르기(숨은 파일 칸)에 시험 원곡을 넣고 다 읽을 때까지 기다린다 */
async function openReference(page: Page): Promise<void> {
  await page.locator('input[type=file][accept*="audio"]').setInputFiles(TONE);
  await expect(page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true })).toBeVisible();
}

interface SavedProject {
  editor: { video?: { name: string; offset: number; speed?: number }; reference?: { name: string; offsetMs: number } };
}

/** 지금 곡을 프로젝트로 저장해 읽는다 */
async function savedProject(page: Page, path: string): Promise<SavedProject> {
  const download = page.waitForEvent("download");
  await menu(page, "파일", /프로젝트로 저장/);
  await (await download).saveAs(path);
  return JSON.parse(readFileSync(path, "utf8")) as SavedProject;
}

/** 파일 메뉴 → 악보 열기로 글 파일을 연다 */
async function openScoreFile(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await menu(page, "파일", /악보 열기/);
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
}

/** 배경 영상 고르기(숨은 파일 칸)에 시험 영상을 넣는다 */
async function openVideo(page: Page): Promise<void> {
  await page.locator('input[type=file][accept*="video"]:not([accept*="audio"])').setInputFiles(FALLING);
}

test("속도 자동 재기가 끝난 뒤 롤을 굴리면 멈춘 배경 영상도 그 자리 장면으로 옮긴다", async ({ page }) => {
  await openApp(page);
  // 영상(6초)보다 긴 곡: 굴려서 옮길 자리가 있게
  await pasteAsNewSong(page, `MML@t120l4${"cdefgab>c<".repeat(20)};`);
  await openVideo(page);
  // 새로 연 영상은 건반 맞춤이 켜져 있어 열자마자 속도를 한 번 잰다. 잰 값이 영상 설정에 들어가야 시험이 뜻이 있다
  await expect(page.getByText(/영상 속도 \d+px\/초에 롤 확대를 맞췄어요/)).toBeVisible({ timeout: 20_000 });
  const videoTime = () => page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
  // 재기가 끝나면 원래 장면(곡 처음 = 영상 0초)으로 돌아온다
  await expect.poll(videoTime).toBeLessThan(0.05);
  const roll = page.locator("canvas").first();
  const box = await roll.boundingBox();
  if (!box) throw new Error("롤 캔버스가 보이지 않는다");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 300);
  // 롤 화면 시작 위치가 바뀌면 영상도 그 장면으로 (전에는 재기 뒤 효과가 화면 위치를 잃어 0초에 멈춰 있었다)
  await expect.poll(videoTime).toBeGreaterThan(0.5);
});

test("영상을 연 채 같은 영상 맞춤값이 적힌 프로젝트를 열면 영상을 두고 그 프로젝트의 맞춤값을 바로 쓴다", async ({ page }, testInfo) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await openVideo(page);
  await expect(page.getByText(/영상 속도 \d+px\/초에 롤 확대를 맞췄어요/)).toBeVisible({ timeout: 20_000 });
  const offset = page.getByLabel("어긋남(초)", { exact: true });

  // 프로젝트 B: 지금 곡을 저장하고, 적힌 영상 어긋남만 0.75초로 바꾼 파일
  const project = await savedProject(page, testInfo.outputPath("b.mme"));
  expect(project.editor.video?.name).toBe("falling-notes.webm");
  project.editor.video!.offset = 0.75;

  // 지금 연 영상은 어긋남 1.5초 (앞 곡의 맞춤값)
  await offset.fill("1.5");
  await openScoreFile(page, "b.mme", JSON.stringify(project));
  // 같은 영상이라 열어 둔 채 프로젝트 B의 맞춤값(0.75)을 쓴다
  await expect(offset).toHaveValue("0.75");
  // 같은 영상을 다시 골라도 그대로
  await openVideo(page);
  await expect(offset).toHaveValue("0.75");
});

test("다른 악보를 열면 앞 곡의 원곡과 배경 영상을 닫는다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await openReference(page);
  await openVideo(page);
  const referenceOffset = page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true });
  const videoOffset = page.getByLabel("어긋남(초)", { exact: true });
  await expect(referenceOffset).toBeVisible();
  await expect(videoOffset).toBeVisible();
  await openScoreFile(page, "other.mml", "MML@t100l8gfedc;");
  await expect(page.getByText(/^음 5개$/).first()).toBeVisible();
  await expect(referenceOffset).toHaveCount(0);
  await expect(videoOffset).toHaveCount(0);
});

/** 가온 도 한 음짜리 MIDI (형식 0, 4분음표 480틱) */
const ONE_NOTE_MIDI = [
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 13, 0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00,
];

test("MIDI 파일과 원곡을 함께 끌어다 놓고 가져오면 그 원곡은 두고 앞 곡의 영상만 닫는다", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await openVideo(page);
  const referenceOffset = page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true });
  const videoOffset = page.getByLabel("어긋남(초)", { exact: true });
  await expect(videoOffset).toBeVisible();
  const wav = [...readFileSync(TONE)];
  await page.evaluate(
    ({ midi, wav }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(midi)], "song.mid", { type: "audio/midi" }));
      data.items.add(new File([new Uint8Array(wav)], "tone.wav", { type: "audio/wav" }));
      document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { midi: ONE_NOTE_MIDI, wav },
  );
  await expect(referenceOffset).toBeVisible();
  await page.getByRole("button", { name: "가져오기", exact: true }).click();
  await expect(page.getByText(/^음 1개$/).first()).toBeVisible();
  await expect(referenceOffset).toBeVisible();
  await expect(videoOffset).toHaveCount(0);
});

test("같은 원곡이 적힌 프로젝트를 열면 원곡을 두고 그 프로젝트의 원곡 어긋남을 쓴다", async ({ page }, testInfo) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await openReference(page);
  const referenceOffset = page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true });
  await referenceOffset.fill("250");
  await referenceOffset.press("Enter");
  const project = await savedProject(page, testInfo.outputPath("ref.mme"));
  expect(project.editor.reference).toMatchObject({ name: "tone.wav", offsetMs: 250 });
  await referenceOffset.fill("900");
  await referenceOffset.press("Enter");
  await openScoreFile(page, "ref.mme", JSON.stringify(project));
  await expect(referenceOffset).toHaveValue("250");
});

test("프로젝트를 열고 다른 영상을 잘못 골랐다 빼도, 프로젝트에 적힌 영상의 맞춤값은 남는다", async ({ page }, testInfo) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await openVideo(page);
  await expect(page.getByText(/영상 속도 \d+px\/초에 롤 확대를 맞췄어요/)).toBeVisible({ timeout: 20_000 });
  const project = await savedProject(page, testInfo.outputPath("c.mme"));
  project.editor.video!.offset = 0.75;
  await page.getByRole("button", { name: "영상 빼기", exact: true }).click();

  // 영상 없이 프로젝트를 연 뒤 다른 영상을 잘못 골랐다가 뺀다
  await openScoreFile(page, "c.mme", JSON.stringify(project));
  await page.locator('input[type=file][accept*="video"]:not([accept*="audio"])').setInputFiles(FAST);
  const offset = page.getByLabel("어긋남(초)", { exact: true });
  await expect(offset).toBeVisible();
  await page.getByRole("button", { name: "영상 빼기", exact: true }).click();
  await expect(offset).toHaveCount(0);
  // 프로젝트에 적힌 영상을 고르면 그 맞춤값(0.75)으로 연다
  await openVideo(page);
  await expect(offset).toHaveValue("0.75");
});

/** 재기가 끝나기 전에 무언가 할 수 있게 영상 옮기기를 느리게 한다 (seeked 알림을 0.4초 늦추고 프레임 알림은 끈다) */
async function slowSeeks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
      if (type === "seeked" && this instanceof HTMLVideoElement && typeof fn === "function") {
        return add.call(this, type, (e: Event) => setTimeout(() => fn.call(this, e), 400), opts);
      }
      return add.call(this, type, fn, opts);
    };
    delete (HTMLVideoElement.prototype as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback;
  });
}

/** 지금 곡을 프로젝트로 저장해 적힌 영상 맞춤값을 읽는다 */
async function savedVideo(page: Page, path: string): Promise<{ name: string; speed?: number }> {
  return (await savedProject(page, path)).editor.video!;
}

test("속도 자동 재기 중에 다른 영상으로 바꾸면 앞 재기를 그만두고 새 영상을 잰다", async ({ page }, testInfo) => {
  await slowSeeks(page);
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await openVideo(page);
  await expect(page.getByText("속도를 재는 중…")).toBeVisible();
  // 같은 무늬가 더 빨리(1초에 90px) 내려오는 영상으로 바꾼다
  await page.locator('input[type=file][accept*="video"]:not([accept*="audio"])').setInputFiles(FAST);
  await expect(page.getByText(/영상 속도 \d+px\/초에 롤 확대를 맞췄어요/)).toBeVisible({ timeout: 20_000 });

  const video = await savedVideo(page, testInfo.outputPath("swap.mme"));
  // 새 영상의 속도가 적혔다 (앞 영상은 1초에 40px. 바꾸기 전에는 새 영상을 재지 않아 속도가 비었다)
  expect(video.name).toBe("falling-notes-fast.webm");
  expect(video.speed).toBeGreaterThan(60);
});

test("속도 자동 재기 중에 재생을 시작하면 재기를 그만두고 속도를 적지 않는다", async ({ page }, testInfo) => {
  await slowSeeks(page);
  await openApp(page);
  await pasteAsNewSong(page, `MML@t120l4${"cdefgab>c<".repeat(20)};`);
  await openVideo(page);
  await expect(page.getByText("속도를 재는 중…")).toBeVisible();
  // 재는 중에 영상 재생 (곡 재생과 같이 재생이 영상을 옮겨, 잰 두 장면이 엉뚱해진다. 시험 환경은 소리 팩이 없어 곡 재생 단추가 꺼져 있다)
  await page.getByRole("button", { name: "영상 재생", exact: true }).click();
  await expect(page.getByText("속도를 재는 중…")).toBeHidden({ timeout: 10_000 });
  // 재기를 그만둔 것이라 "잰 속도"도 "못 쟀다"도 띄우지 않고, 틀린 속도를 적지 않는다
  await expect(page.getByText(/영상 속도 \d+px\/초|움직임을 찾지 못했어요/)).toHaveCount(0);
  expect((await savedVideo(page, testInfo.outputPath("play.mme"))).speed).toBeUndefined();
});
