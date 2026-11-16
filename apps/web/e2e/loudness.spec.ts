import type { Page } from "@playwright/test";
import { exportMml, expect, menu, openApp, pasteAsNewSong, test } from "./fixtures";

// 실험실 원곡 대조 셈여림: 제안이 있는 칸(반 마디)의 고치기 단추로 볼륨 일괄 조정을 그 칸만·±제안으로 열어 고친다

/**
 * 합성 원곡 (8kHz 모노 16비트, 16초 = t120 4/4 8마디, 440Hz 사인파).
 * 3마디 뒤 반(5-6초)만 다섯 배 크게 친다. 실제 녹음이 아니다
 */
function syntheticReference(): Buffer {
  const rate = 8000;
  const count = rate * 16;
  const data = Buffer.alloc(44 + count * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + count * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const amp = t >= 5 && t < 6 ? 0.5 : 0.1;
    data.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * 440 * t) * 32767), 44 + i * 2);
  }
  return data;
}

async function openReference(page: Page): Promise<void> {
  await page.locator('input[type=file][accept*="audio"]').setInputFiles({ name: "ref.wav", mimeType: "audio/wav", buffer: syntheticReference() });
  await expect(page.getByLabel("어긋남(ms, 원곡이 늦으면 +)", { exact: true })).toBeVisible();
}

test("반 마디 칸의 고치기로 그 칸에서 시작하는 음만 제안만큼 올리고, 실행 취소 한 번으로 돌아온다", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mmlce.labs", "1");
    // 사인파 원곡은 템포 자동 맞추기로 찾을 모양이 없어 끄고, 반 마디로 나눠 본다
    localStorage.setItem("mmlce.loudnessPanel", JSON.stringify({ mode: "big", autoTempo: false, halves: true, onlyBig: true }));
  });
  await openApp(page);
  await pasteAsNewSong(page, `MML@t120l4v10${"cccc".repeat(8)};`);
  await openReference(page);
  await menu(page, "실험실", /원곡 대조 셈여림/);
  const panel = page.locator("dialog.panel");
  // 크게 차이 나는 칸만 보면 3½ 한 줄
  const row = panel.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").first()).toHaveText("3½");
  const suggest = (await row.locator("td.suggest").innerText()).match(/\(\+(\d+)\)/);
  expect(suggest).not.toBeNull();
  const by = Number(suggest![1]);
  expect(by).toBeGreaterThan(0);

  await row.getByRole("button", { name: "고치기…" }).click();
  const dialog = page.locator("dialog[open]").filter({ has: page.getByRole("heading", { name: "볼륨 일괄 조정" }) });
  await expect(dialog.getByLabel("비교한 칸만 (3½마디)")).toBeChecked();
  await expect(dialog.getByLabel("올리고 내리기")).toBeChecked();
  await expect(dialog.getByRole("spinbutton")).toHaveValue(String(by));
  // 3마디 뒤 반에서 시작하는 음 두 개만
  await expect(dialog.getByText(/음 2개 가운데 2개/)).toBeVisible();
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // 곡을 고치면 패널이 바로 다시 센다: 그 칸 제안이 줄거나 사라진다
  await expect(panel.locator("tbody tr td.suggest", { hasText: `(+${by})` })).toHaveCount(0);
  await panel.getByRole("button", { name: "닫기" }).click();

  const after = await exportMml(page);
  expect(after).toContain(`v10${"c".repeat(10)}v${10 + by}ccv10${"c".repeat(20)}`);
  await page.getByRole("button", { name: "실행 취소" }).click();
  expect(await exportMml(page)).toContain(`v10${"c".repeat(32)}`);
});
