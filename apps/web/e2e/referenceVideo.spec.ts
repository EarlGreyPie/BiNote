import { fileURLToPath } from "node:url";
import { expect, openApp, pasteAsNewSong, test } from "./fixtures";

// 원곡 영상 띄우기: 영상 파일로 불러온 원곡의 화면을 떠 있는 창으로 보고, 원곡 어긋남을 따라간다

/**
 * 합성한 시험 영상 (160×90, 10fps, 4초, 440Hz 사인파 소리). 실제 원곡이 아니다.
 * 만든 명령: ffmpeg -f lavfi -i "testsrc=s=160x90:r=10:d=4" -f lavfi -i "sine=f=440:d=4:sample_rate=48000" -c:v libvpx -b:v 40k -c:a libopus -b:a 16k -shortest tone-video.webm
 */
const TONE_VIDEO = fileURLToPath(new URL("./assets/tone-video.webm", import.meta.url));
const TONE = fileURLToPath(new URL("./assets/tone.wav", import.meta.url));

test("영상 원곡은 떠 있는 창으로 띄우고, 멈춰 있으면 커서 자리 + 어긋남 장면을 보여 준다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await page.locator('input[type=file][accept*="audio"]').setInputFiles(TONE_VIDEO);
  const offset = page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true });
  await expect(offset).toBeVisible();

  const show = page.getByRole("button", { name: "영상 띄우기" }).first();
  await show.click();
  const panel = page.getByRole("dialog", { name: "원곡 영상" });
  await expect(panel).toBeVisible();
  const videoTime = () => page.evaluate(() => document.querySelector<HTMLVideoElement>(".ref-video video")?.currentTime ?? -1);
  await expect.poll(videoTime).toBeLessThan(0.05);

  // 원곡이 1.5초 늦게(+) 맞춰져 있으면 곡 처음에 원곡 1.5초 자리가 보인다
  await offset.fill("1500");
  await offset.press("Enter");
  await expect.poll(videoTime).toBeGreaterThan(1.4);
  await expect.poll(videoTime).toBeLessThan(1.6);

  // 원곡을 빼면 창도 닫힌다
  await page.getByRole("button", { name: "영상 빼기" }).first().click();
  await expect(panel).toHaveCount(0);
});

test("소리 원곡에는 영상 띄우기 단추가 없다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, "MML@t120l4cdefgab>c;");
  await page.locator('input[type=file][accept*="audio"]').setInputFiles(TONE);
  await expect(page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "영상 띄우기" })).toHaveCount(0);
});
