import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, planReverbBatch, planReverbStamp, rat, reverbLevel, type Note, type Rat, type Song } from "../src/index.js";

const n = (id: string, at: Rat, dur: Rat, pitch: number, vol: number, extra: Partial<Note> = {}): Note => ({ id, start: at, dur, pitch, vol, tie: "none", ...extra });

function songOf(notes: Note[]): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [{ id: "p1", name: "p", instrument: { canonical: "piano" } }],
    tracks: [{ id: "t1", playerId: "p1", name: "t", color: "", role: "free", mute: false, solo: false, notes, spelling: {} }],
  };
}
function ctx(extra: { locked?: ReadonlySet<string>; canWrite?: (r: Rat) => boolean } = {}) {
  let k = 0;
  return { canWrite: () => true, newId: () => `rv${++k}`, ...extra };
}
const notesOf = (r: { changes: readonly { notes: readonly Note[] }[] }) => r.changes[0]?.notes ?? [];
const shape = (notes: readonly Note[]) => notes.map((x) => `${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d} v${x.vol}`);
const tail = { levels: [6, 3, 2, 1], piece: rat(1, 8), keep: rat(1, 4) };
const batch = { ...tail, minLength: rat(1, 2), beforeRest: false, fillMaxNote: rat(1, 8) };

describe("울림 v 단계", () => {
  it("가장 큰 v 기준 단계를 음의 v에 비례해 줄이고, 1 아래·원래 v 위로 가지 않는다", () => {
    expect([6, 3, 2, 1].map((l) => reverbLevel(l, 15, MOBILE_PROFILE))).toEqual([6, 3, 2, 1]);
    expect([6, 3, 2, 1].map((l) => reverbLevel(l, 9, MOBILE_PROFILE))).toEqual([4, 2, 1, 1]);
    expect(reverbLevel(20, 5, MOBILE_PROFILE)).toBe(5);
    expect(reverbLevel(6, 0, MOBILE_PROFILE)).toBe(0);
  });

  it("v0(소리 없는) 음에는 울림을 넣지 않는다: 찍기·일괄 모두 곡을 그대로 두고 건너뛴 수로 센다", () => {
    const s = songOf([n("a", rat(0), rat(1), 60, 0), n("b", rat(1), rat(1, 16), 62, 0), n("c", rat(5, 4), rat(1), 64, 0)]);
    const stamp = planReverbStamp(s, "t1", "a", rat(1, 2), tail, MOBILE_PROFILE, ctx());
    expect(stamp.changes).toHaveLength(0);
    expect(stamp.skipped.silent).toBe(1);
    const all = planReverbBatch(s, s.tracks[0]!.notes, { ...batch, fillLevel: 4 }, MOBILE_PROFILE, ctx());
    expect(all.changes).toHaveLength(0);
    expect(all.skipped.silent).toBe(3);
  });
});

describe("& 사슬 볼륨", () => {
  it("v0으로 시작한 & 사슬은 뒤 조각에 v15를 적어도 무음이라 울림을 넣지 않는다 (게임은 & 뒤 v를 무시)", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60, 0, { tie: "next" }), n("b", rat(1, 4), rat(1), 60, 15)]);
    const stamp = planReverbStamp(s, "t1", "b", rat(3, 4), tail, MOBILE_PROFILE, ctx());
    expect(stamp.changes).toHaveLength(0);
    expect(stamp.skipped.silent).toBe(1);
    const all = planReverbBatch(s, s.tracks[0]!.notes, batch, MOBILE_PROFILE, ctx());
    expect(all.changes).toHaveLength(0);
    expect(all.skipped.silent).toBe(1);
    expect(all.skipped.tied).toBe(1);
  });

  it("v15로 시작한 & 사슬 뒤 조각이 v0으로 적혀 있어도 사슬 v15 기준으로 꼬리를 낸다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60, 15, { tie: "next" }), n("b", rat(1, 4), rat(1), 60, 0)]);
    const r = planReverbStamp(s, "t1", "b", rat(3, 4), tail, MOBILE_PROFILE, ctx());
    expect(r.tails).toBe(1);
    expect(notesOf(r).slice(2).map((x) => x.vol)).toEqual([6, 3, 2, 1]);
  });
});

describe("울림 찍기", () => {
  it("누른 자리부터 조각으로 쪼개고, v 단계를 다 쓰면 마지막 조각이 남은 길이를 가진다. &로 잇지 않는다", () => {
    const s = songOf([n("a", rat(0), rat(1), 60, 15)]);
    const r = planReverbStamp(s, "t1", "a", rat(1, 2), tail, MOBILE_PROFILE, ctx());
    const out = notesOf(r);
    expect(shape(out)).toEqual(["0/1+1/2 v15", "1/2+1/8 v6", "5/8+1/8 v3", "3/4+1/8 v2", "7/8+1/8 v1"]);
    expect(out.every((x) => x.tie === "none" && x.pitch === 60)).toBe(true);
    expect(r.tails).toBe(1);
    expect(r.added).toBe(4);
    // 조각보다 자리가 남으면 마지막 조각이 길어진다
    const r2 = planReverbStamp(s, "t1", "a", rat(1, 4), { ...tail, levels: [6, 3] }, MOBILE_PROFILE, ctx());
    expect(shape(notesOf(r2))).toEqual(["0/1+1/4 v15", "1/4+1/8 v6", "3/8+5/8 v3"]);
    // 조각 길이보다 짧게 남으면 v 단계가 남았을 때 짧은 조각을 하나 더 친다
    const r3 = planReverbStamp(s, "t1", "a", rat(13, 16), tail, MOBILE_PROFILE, ctx());
    expect(shape(notesOf(r3))).toEqual(["0/1+13/16 v15", "13/16+1/8 v6", "15/16+1/16 v3"]);
  });

  it("음 시작을 누르면 끝에서부터 놓고 앞부분은 keep 이상 남긴다", () => {
    const s = songOf([n("a", rat(0), rat(1, 2), 60, 12)]);
    const out = notesOf(planReverbStamp(s, "t1", "a", rat(0), tail, MOBILE_PROFILE, ctx()));
    expect(shape(out)).toEqual(["0/1+1/4 v12", "1/4+1/8 v5", "3/8+1/8 v2"]);
  });

  it("뒤로 &로 이어진 음·잠근 트랙·쓸 수 없는 길이는 바꾸지 않는다", () => {
    const s = songOf([n("a", rat(0), rat(1, 2), 60, 12, { tie: "next" }), n("b", rat(1, 2), rat(1, 2), 62, 12)]);
    expect(planReverbStamp(s, "t1", "a", rat(1, 4), tail, MOBILE_PROFILE, ctx()).skipped.tied).toBe(1);
    expect(planReverbStamp(s, "t1", "b", rat(3, 4), tail, MOBILE_PROFILE, ctx({ locked: new Set(["t1"]) })).skipped.locked).toBe(1);
    const odd = planReverbStamp(s, "t1", "b", rat(3, 4), tail, MOBILE_PROFILE, ctx({ canWrite: (r) => r.d <= 4 }));
    expect(odd.changes).toEqual([]);
    expect(odd.skipped.unwritable).toBe(1);
  });

  it("&로 이어 받은 음(슬라이드 끝)은 쪼갤 수 있다: 앞 음의 &는 그대로 머리에 이어진다", () => {
    const s = songOf([n("a", rat(0), rat(1, 8), 59, 12, { tie: "next" }), n("b", rat(1, 8), rat(7, 8), 60, 12)]);
    const out = notesOf(planReverbStamp(s, "t1", "b", rat(1, 2), tail, MOBILE_PROFILE, ctx()));
    expect(out[0]!.tie).toBe("next");
    expect(out[1]!.id).toBe("b");
    expect(out[1]!.dur).toEqual(rat(3, 8));
  });
});

describe("울림 일괄 넣기", () => {
  it("이 길이 이상인 음에만 꼬리를 넣고, 짧은 음은 건너뛴다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60, 15), n("b", rat(1, 4), rat(3, 4), 62, 15)]);
    const r = planReverbBatch(s, s.tracks[0]!.notes, batch, MOBILE_PROFILE, ctx());
    expect(shape(notesOf(r))).toEqual(["0/1+1/4 v15", "1/4+1/4 v15", "1/2+1/8 v6", "5/8+1/8 v3", "3/4+1/8 v2", "7/8+1/8 v1"]);
    expect(r.tails).toBe(1);
    expect(r.skipped.short).toBe(1);
  });

  it("뒤에 쉼표가 있는 음에만: 바로 다음 음이 붙어 있으면 넣지 않는다", () => {
    const s = songOf([n("a", rat(0), rat(1, 2), 60, 15), n("b", rat(1, 2), rat(1, 2), 62, 15), n("c", rat(3, 2), rat(1, 4), 64, 15)]);
    const r = planReverbBatch(s, s.tracks[0]!.notes, { ...batch, beforeRest: true }, MOBILE_PROFILE, ctx());
    expect(r.tails).toBe(1);
    expect(notesOf(r).filter((x) => x.pitch === 60)).toHaveLength(1);
    expect(notesOf(r).filter((x) => x.pitch === 62).length).toBeGreaterThan(1);
  });

  it("스타카토 빈칸 채우기: 짧은 음 뒤 쉼표에 같은 높이를 작게, 음 길이만큼·다음 음 앞까지만", () => {
    const s = songOf([n("a", rat(0), rat(1, 8), 60, 15), n("b", rat(1, 4), rat(1, 8), 62, 15), n("c", rat(7, 16), rat(1, 8), 64, 15), n("d", rat(1), rat(1, 8), 65, 15)]);
    const r = planReverbBatch(s, s.tracks[0]!.notes, { ...batch, fillLevel: 4 }, MOBILE_PROFILE, ctx());
    const out = notesOf(r);
    expect(shape(out)).toEqual(["0/1+1/8 v15", "1/8+1/8 v4", "1/4+1/8 v15", "3/8+1/16 v4", "7/16+1/8 v15", "9/16+1/8 v4", "1/1+1/8 v15"]);
    expect(out.filter((x) => x.vol === 4).every((x) => x.tie === "none")).toBe(true);
    // 트랙 끝 음 뒤는 채우지 않는다
    expect(r.fills).toBe(3);
  });

  it("고르지 않은 음은 그대로, 결과에서 음이 겹치지 않는다", () => {
    const s = songOf([n("a", rat(0), rat(1), 60, 12), n("b", rat(1), rat(1), 62, 12)]);
    const out = notesOf(planReverbBatch(s, [s.tracks[0]!.notes[0]!], batch, MOBILE_PROFILE, ctx()));
    expect(out.find((x) => x.id === "b")).toEqual(s.tracks[0]!.notes[1]);
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]!;
      expect(prev.start.n / prev.start.d + prev.dur.n / prev.dur.d).toBeLessThanOrEqual(out[i]!.start.n / out[i]!.start.d + 1e-9);
    }
  });
});
