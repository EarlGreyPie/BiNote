import type { Page } from "@playwright/test";
import { expect, openApp, pasteAsNewSong, test } from "./fixtures";

// 실험실 음량 레인 원곡 세기 안내선: 원곡을 불러온 곡에서만 단추가 생기고, 켜면 레인에 안내선이 그려진다 (곡은 그대로)

const RATE = 8000;

/** 합성 독주 녹음: 0.5초(t120 4분음표)마다 점점 세게 치는 사인 클릭 8개를 16비트 모노 WAV로 */
function clickWav(): Buffer {
  const amps = [0.15, 0.2, 0.25, 0.32, 0.4, 0.5, 0.65, 0.85];
  const x = new Float32Array(RATE * 5);
  amps.forEach((amp, k) => {
    const from = Math.round(k * 0.5 * RATE);
    for (let i = 0; i < 0.3 * RATE; i++) x[from + i]! += amp * Math.exp(-i / (0.08 * RATE)) * Math.sin((2 * Math.PI * 440 * i) / RATE);
  });
  const data = Buffer.alloc(x.length * 2);
  x.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

async function openReference(page: Page): Promise<void> {
  await page.locator('input[type=file][accept*="audio"]').setInputFiles({ name: "clicks.wav", mimeType: "audio/wav", buffer: clickWav() });
  await expect(page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true })).toBeVisible();
}

const SONG = "MML@t120l4v8cdefgab>c;";

test("실험실을 끄면 원곡이 있어도 원곡 세기 단추가 없다", async ({ page }) => {
  await openApp(page);
  await pasteAsNewSong(page, SONG);
  await openReference(page);
  await page.getByRole("button", { name: "음량 레인 크게" }).first().click();
  await expect(page.getByRole("button", { name: "원곡 세기" })).toHaveCount(0);
});

test("실험실을 켜면 원곡 세기 단추가 생기고, 켜도 곡은 그대로다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mmlce.labs", "1"));
  await openApp(page);
  await pasteAsNewSong(page, SONG);
  // 원곡이 없으면 단추가 없다
  await page.getByRole("button", { name: "음량 레인 크게" }).first().click();
  await expect(page.getByRole("button", { name: "원곡 세기" })).toHaveCount(0);
  await openReference(page);
  const toggle = page.getByRole("button", { name: "원곡 세기" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // 보기만: 실행 취소할 것이 생기지 않는다
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();
  // 설정은 이 브라우저에 남는다
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mmlce.volumeLane") ?? "{}").guide)).toBe(true);
});
