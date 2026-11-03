import { expect, exportMml, focusRoll, noteCount, openApp, test, trackTabs } from "./fixtures";

// MIDI 가져오기 → 화음이 여러 트랙으로 나뉜 곡에서 롤 편집·실행 취소·MML 내보내기 (Basic Scriptor 점검 3번)

/** 작은 SMF 형식 1 (PPQ 480): 0번 트랙 템포·마커, 오른손 3음·왼손 2음 화음 네 마디 */
function chordMidi(): Buffer {
  const vlq = (v: number) => {
    const out = [v & 0x7f];
    while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const track = (events: [number, number[]][]) => {
    const body: number[] = [];
    let last = 0;
    for (const [tick, bytes] of events) {
      body.push(...vlq(tick - last), ...bytes);
      last = tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body];
  };
  const text = (type: number, s: string) => {
    const b = [...Buffer.from(s, "utf8")];
    return [0xff, type, ...vlq(b.length), ...b];
  };
  const chords = (pitches: number[][]) => {
    const ev: [number, number[]][] = [];
    pitches.forEach((chord, bar) => {
      for (const p of chord) ev.push([bar * 1920, [0x90, p, 90]]);
      for (const p of chord) ev.push([bar * 1920 + 1900, [0x80, p, 0]]);
    });
    return ev;
  };
  const conductor = track([
    [0, [0xff, 0x51, 3, 0x07, 0xa1, 0x20]],
    [0, text(0x06, "A")],
    [3840, text(0x06, "B")],
  ]);
  const right = track([[0, text(0x03, "piano")], [0, [0xc0, 0]], ...chords([[72, 76, 79], [74, 77, 81], [76, 79, 83], [72, 76, 79]])]);
  const left = track([[0, text(0x03, "piano left")], [0, [0xc0, 0]], ...chords([[48, 55], [50, 57], [52, 59], [48, 55]])]);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, 0x01, 0xe0];
  return Buffer.from([...header, ...conductor, ...right, ...left]);
}

test("MIDI 화음을 여러 트랙으로 가져와 나뉜 트랙을 고치고 되돌리고 내보낸다", async ({ page }) => {
  await openApp(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "악보 열기", exact: true }).click();
  await (await chooser).setFiles({ name: "화음.mid", mimeType: "audio/midi", buffer: chordMidi() });
  const dialog = page.locator("dialog[open]").filter({ hasText: "MIDI 가져오기" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "가져오기", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // 화음 5음이 트랙 여러 개로 나뉜다
  const count = await trackTabs(page).count();
  expect(count).toBeGreaterThanOrEqual(4);
  const before = await exportMml(page);
  expect(before.split(/[,;]/).filter((t) => /[a-g]/.test(t)).length).toBe(count);

  // 마지막(나뉜) 트랙을 골라 모든 음을 한 옥타브 올린다
  await trackTabs(page).nth(count - 1).click();
  await expect(noteCount(page)).toHaveText("음 4개");
  await focusRoll(page);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Shift+ArrowUp");
  const raised = await exportMml(page);
  expect(raised).not.toBe(before);
  // 고른 트랙 글만 바뀐다. 내보내기 창은 이미 복사한 트랙을 빼고 바뀐 트랙을 먼저 골라 두므로
  // 붙여넣는 글의 트랙 차례가 달라질 수 있어, 글 묶음으로 견준다
  const texts = (s: string) => s.replace(/^MML@/, "").replace(/;$/, "").split(",");
  const left = [...texts(before)];
  const changed = texts(raised).filter((t) => {
    const i = left.indexOf(t);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  expect(changed).toHaveLength(1);

  await focusRoll(page);
  await page.keyboard.press("Control+Z");
  expect(texts(await exportMml(page)).sort()).toEqual(texts(before).sort());
});
