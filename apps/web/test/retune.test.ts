import { describe, expect, it } from "vitest";
import { assignTab, STANDARD_TUNING, type Note, type TabTuning, type Track } from "@mmlce/core";
import { parseMml } from "@mmlce/mml";
import { retuneKeepingTab } from "../src/lib/retune";
import { TUNINGS } from "../src/lib/tunings";

function trackOf(mml: string, id = "t1"): Track {
  const notes: Note[] = parseMml(mml).notes.map((n, i) => ({ id: `${id}.${i}`, start: n.start, dur: n.dur, pitch: n.pitch, vol: n.vol, tie: n.tie }));
  return { id, playerId: "p1", name: id, color: "", role: "free", mute: false, solo: false, spelling: {}, notes };
}

const tuningOf = (name: keyof typeof TUNINGS, capo = 0): TabTuning => ({ ...STANDARD_TUNING, strings: TUNINGS[name].strings, capo });

/** 줄:프렛 (칠 수 없는 음은 "-") */
const frets = (tracks: readonly Track[], tuning: TabTuning) =>
  assignTab(tracks.flatMap((t) => t.notes), tuning).flatMap((e) => e.notes.map((x) => (x.at ? `${x.at.string}:${x.at.fret}` : "-")));

const apply = (tracks: readonly Track[], r: ReturnType<typeof retuneKeepingTab>) =>
  tracks.map((t) => ({ ...t, notes: r.changes.find((c) => c.trackId === t.id)?.notes ?? t.notes }));

describe("타브 그대로 튜닝 바꾸기", () => {
  it("줄·프렛 숫자는 그대로, 높이는 새 튜닝 것으로 바뀐다 (표준 → 드롭 D: 6번 줄만 온음 아래)", () => {
    const tracks = [trackOf("o2e4o3c4o4e4")];
    const from = tuningOf("standard");
    const to = tuningOf("dropD");
    const before = frets(tracks, from);
    const r = retuneKeepingTab(tracks, from, to);
    const after = apply(tracks, r);
    expect(frets(after, to)).toEqual(before);
    expect(after[0]!.notes.map((n) => n.pitch)).toEqual([38, 48, 64]);
    expect(r.moved).toBe(1);
    expect(r.kept).toBe(0);
  });

  it("카포만 바꿔도 숫자를 지킨다 (높이가 카포만큼 오른다)", () => {
    const tracks = [trackOf("o4c4e4g4")];
    const from = tuningOf("standard");
    const to = tuningOf("standard", 2);
    const r = retuneKeepingTab(tracks, from, to);
    const after = apply(tracks, r);
    expect(frets(after, to)).toEqual(frets(tracks, from));
    expect(after[0]!.notes.map((n) => n.pitch)).toEqual([62, 66, 69]);
  });

  it("같은 높이로 &한 뒷음은 앞 음을 따라 옮기고, 화음도 줄마다 제 높이로 바뀐다", () => {
    const tracks = [trackOf("o2e2&e2"), trackOf("o3e2&e2", "t2")];
    const from = tuningOf("standard");
    const to = tuningOf("baritoneB");
    const r = retuneKeepingTab(tracks, from, to);
    const after = apply(tracks, r);
    expect(after[0]!.notes.map((n) => n.pitch)).toEqual([35, 35]);
    expect(after[0]!.notes[0]!.tie).toBe("next");
    expect(frets(after.map((t) => ({ ...t, notes: t.notes.slice(0, 1) })), to)).toEqual(frets(tracks.map((t) => ({ ...t, notes: t.notes.slice(0, 1) })), from));
    expect(r.moved).toBe(4);
  });

  it("지금 타브에 자리가 없는 음과 새 튜닝에 없는 줄의 음은 그대로 둔다 (6줄 → 4줄 베이스)", () => {
    const tracks = [trackOf("o1c4o2e4o4e4")];
    const from = tuningOf("standard");
    const to = tuningOf("bass4");
    const r = retuneKeepingTab(tracks, from, to);
    const after = apply(tracks, r);
    // o1c: 표준 튜닝에 자리 없음 / o2e: 6번 줄 개방현 → 베이스에 6번 줄 없음 / o4e: 1번 줄 개방현 → 베이스 1번 줄 G
    expect(after[0]!.notes.map((n) => n.pitch)).toEqual([24, 40, 43]);
    expect(r.kept).toBe(2);
    expect(r.moved).toBe(1);
  });

  it("바뀌는 높이가 없으면 아무것도 바꾸지 않는다", () => {
    const tracks = [trackOf("o4c4e4g4")];
    const r = retuneKeepingTab(tracks, tuningOf("standard"), tuningOf("standard"));
    expect(r.changes).toEqual([]);
    expect(r.moved).toBe(0);
  });
});
