import { describe, expect, it } from "vitest";
import { attenuateChordVolumes, attenuatedVolume, MOBILE_PROFILE, rat, type AttenuationOptions, type AttenuationTrack, type Note, type TrackRole } from "../src/index.js";

/** start·dur는 1/48 단위 */
const note = (id: string, start: number, dur: number, pitch: number, vol = 10, tie: Note["tie"] = "none"): Note => ({
  id,
  start: rat(start, 48),
  dur: rat(dur, 48),
  pitch,
  vol,
  tie,
});
const track = (id: string, notes: Note[], role: TrackRole = "free"): AttenuationTrack => ({ id, role, notes });
const opts = (o: Partial<AttenuationOptions> = {}): AttenuationOptions => ({
  split: "pitch",
  amount: { kind: "steps", two: 1, three: 2, fourPlus: 3 },
  roll: rat(1, 16),
  sameStartOnly: false,
  floor: 1,
  ...o,
});
const all = (tracks: readonly AttenuationTrack[]) => new Map(tracks.map((t) => [t.id, undefined]));
const vols = (r: ReturnType<typeof attenuateChordVolumes>, tracks: readonly AttenuationTrack[]) =>
  tracks.map((t) => (r.tracks.get(t.id) ?? t.notes).map((n) => n.vol));

describe("편집기 화음 감쇠", () => {
  it("같이 시작한 3음은 −2", () => {
    const tr = [track("a", [note("a1", 0, 24, 72)]), track("b", [note("b1", 0, 24, 67)]), track("c", [note("c1", 0, 24, 64)])];
    const r = attenuateChordVolumes(tr, all(tr), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[8], [8], [8]]);
    expect(r.bySize.get(3)).toBe(3);
    expect(r.changed).toBe(3);
    expect(r.fromOverlap).toBe(0);
  });

  it("굴린 화음(1/48씩 늦게)도 3음으로 센다. 같이 시작한 음만 세면 그대로", () => {
    const tr = [track("a", [note("a1", 0, 24, 64)]), track("b", [note("b1", 1, 23, 67)]), track("c", [note("c1", 2, 22, 72)])];
    const r = attenuateChordVolumes(tr, all(tr), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[8], [8], [8]]);
    expect(r.fromOverlap).toBe(3);
    const old = attenuateChordVolumes(tr, all(tr), opts({ sameStartOnly: true }), MOBILE_PROFILE);
    expect(old.changed).toBe(0);
  });

  it("굴림 폭보다 늦게 들어온 음은 첫 음에 세지 않지만, 늦게 온 음은 먼저 울리던 음을 센다", () => {
    const tr = [track("a", [note("a1", 0, 48, 64)]), track("b", [note("b1", 12, 36, 67)])];
    const r = attenuateChordVolumes(tr, all(tr), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[10], [9]]);
  });

  it("굴림 폭 끝에 꼭 맞춰 들어온 음도 같은 화음으로 센다 (모두 같은 양)", () => {
    // MML@v12c1,v12r32e1,v12r16g1; 굴림 폭 1/16
    const n = (id: string, start: number, pitch: number): Note => ({ id, start: rat(start, 32), dur: rat(32 - start, 32), pitch, vol: 12, tie: "none" });
    const tr = [track("a", [n("a1", 0, 60)]), track("b", [n("b1", 1, 64)]), track("c", [n("c1", 2, 67)])];
    const r = attenuateChordVolumes(tr, all(tr), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[10], [10], [10]]);
  });

  it("& 사슬에서 높이가 바뀌면 그 순간 울리는 높이로 무리를 나눈다", () => {
    // 트랙 1 v12c4&>c4, 트랙 2 v12r4>c4: 뒤 C5 두 음은 한 무리
    const tr = [
      track("a", [note("a1", 0, 12, 60, 12, "next"), note("a2", 12, 12, 72, 12)]),
      track("b", [note("b1", 12, 12, 72, 12)]),
    ];
    const r = attenuateChordVolumes(tr, all(tr), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)[1]).toEqual([11]);
  });

  it("빠른 단선율은 한 순간에 한 음이라 낮추지 않는다", () => {
    const tr = [track("a", [0, 3, 6, 9, 12].map((s, i) => note(`a${i}`, s, 3, 60 + i)))];
    const r = attenuateChordVolumes(tr, all(tr), opts({ roll: rat(1, 4) }), MOBILE_PROFILE);
    expect(r.changed).toBe(0);
    expect(r.bySize.get(1)).toBe(5);
  });

  it("음높이 틈으로 위·아래를 따로 센다. 틈이 없으면 한 무리", () => {
    // 베이스 40 길게 + 위 72·76 화음 → 위 2음, 아래 1음
    const tr = [track("bass", [note("x", 0, 48, 40)]), track("m1", [note("m1", 0, 24, 76)]), track("m2", [note("m2", 0, 24, 72)])];
    const r = attenuateChordVolumes(tr, all(tr), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[10], [9], [9]]);
    const one = attenuateChordVolumes(tr, all(tr), opts({ split: "none" }), MOBILE_PROFILE);
    expect(vols(one, tr)).toEqual([[8], [8], [8]]);
    // 붙은 화음 55·59·62는 가운데 도로 가르지 않는다
    const close = [track("a", [note("a", 0, 24, 55)]), track("b", [note("b", 0, 24, 59)]), track("c", [note("c", 0, 24, 62)])];
    expect(vols(attenuateChordVolumes(close, all(close), opts(), MOBILE_PROFILE), close)).toEqual([[8], [8], [8]]);
  });

  it("트랙 역할로 나누면 멜로디·베이스는 따로 센다", () => {
    const tr = [track("m", [note("m", 0, 24, 72)], "melody"), track("h", [note("h", 0, 24, 67)], "harmony"), track("b", [note("b", 0, 24, 64)], "bass")];
    const r = attenuateChordVolumes(tr, all(tr), opts({ split: "role" }), MOBILE_PROFILE);
    expect(r.changed).toBe(0);
  });

  it("& 사슬은 첫 음 v로 함께 바꾸고, 울림은 사슬 끝까지 본다", () => {
    // a: 0~24 & 24~48 (같은 높이), b: 30부터 → b는 사슬과 함께 울린다
    const tr = [track("a", [note("a1", 0, 24, 64, 10, "next"), note("a2", 24, 24, 64, 10)]), track("b", [note("b1", 30, 18, 67)])];
    // 사슬 끝 음만 골라도 사슬 전체를 센다
    const picked = new Map<string, ReadonlySet<string> | undefined>([["a", new Set(["a2"])], ["b", undefined]]);
    const r = attenuateChordVolumes(tr, picked, opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[10, 10], [9]]);
    expect(r.viaTie).toBe(1);
  });

  it("고르지 않은 음도 세지만 바꾸지 않는다", () => {
    const tr = [track("a", [note("a1", 0, 24, 72)]), track("b", [note("b1", 0, 24, 67)])];
    const r = attenuateChordVolumes(tr, new Map([["a", undefined]]), opts(), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[9], [10]]);
    expect(r.tracks.has("b")).toBe(false);
    expect(r.count).toBe(1);
  });

  it("가장 작은 v에서 멈추고, 처음부터 작은 음은 건드리지 않는다. v0은 세지 않는다", () => {
    const tr = [
      track("a", [note("a", 0, 24, 76, 9)]),
      track("b", [note("b", 0, 24, 72, 9)]),
      track("c", [note("c", 0, 24, 67, 9)]),
      track("d", [note("d", 0, 24, 64, 5)]),
      track("e", [note("e", 0, 24, 62, 0)]),
    ];
    const r = attenuateChordVolumes(tr, all(tr), opts({ floor: 7 }), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[7], [7], [7], [5], [0]]);
    expect(r.floored).toBe(3);
    expect(r.bySize.get(4)).toBe(4);
  });

  it("단음 기준 v를 주면 먼저 그 값으로 두고 낮춘다", () => {
    const tr = [track("a", [note("a1", 0, 24, 72, 6), note("a2", 48, 24, 72, 13)]), track("b", [note("b1", 0, 24, 67, 12)])];
    const r = attenuateChordVolumes(tr, all(tr), opts({ base: 10 }), MOBILE_PROFILE);
    expect(vols(r, tr)).toEqual([[9, 10], [9]]);
  });

  it("음량 법칙: 화음 전체가 단음 크기가 되는 v (3 dB/2배)", () => {
    const law = { kind: "law" } as const;
    expect(attenuatedVolume(15, 1, law, MOBILE_PROFILE)).toBe(15);
    // 40·log10(V/15) = −3 → V ≈ 12.6
    expect(attenuatedVolume(15, 2, law, MOBILE_PROFILE)).toBe(13);
    // −6 dB → V ≈ 10.6
    expect(attenuatedVolume(15, 4, law, MOBILE_PROFILE)).toBe(11);
    expect(attenuatedVolume(9, 4, law, MOBILE_PROFILE)).toBeLessThan(9);
  });
});
