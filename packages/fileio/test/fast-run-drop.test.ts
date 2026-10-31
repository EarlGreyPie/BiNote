import { describe, expect, it } from "vitest";
import { add, eq, MOBILE_PROFILE, rat, tempoClock, type Rat, type Song } from "@mmlce/core";
import { delayFor, delayLengths, fastRunMoments, planFastRunFix, setTracksNotes, validateSong } from "@mmlce/mml";
import { readMmlAt } from "../src/index.js";

/*
 * 실험실 연주 누락음 검사(fast-run-drop)을 게임 녹음으로 확인한 시험 판과 견준다 (2026-10-31, 모바일 피아노,
 * dev docs/NOTE_DROP_RESEARCH.md 6.6~6.6.2절). 사용자 자작 편곡(G선상의 아리아 38~40마디)을 잘라 낸 짧은 조각이다.
 * 모든 칸 첫머리에 t를 고정했고, 한 악보 6트랙 피아노로 읽는다
 */
const A =
  "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6v9e24f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const SIXTEENTHS =
  "MML@t116r.r<v12a16v11b16v10b+2v11b2v12ag,t116,t116v14c.&cv12c16v11d16v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e.&ev9e16f+16g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const ONE_GRACE =
  "MML@t116r.r3<v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6r24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6r24v9f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const R64 =
  "MML@t116r2r6<v12a24v11b24r64>v10c&c8.&c32.<v11b2v12ag,t116,t116v14c2&c6v12c24v11d24r64v10e&e8.&e32.v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6v9e24f+24r64g&g8.&g32.f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
// 이어서 잰 판(같은 날): M1 트랙 2개 × 빠른 음 3개(합 6, 같은 구간) → C4·G3 빠짐, M2 A판에서 계속 울리던 A3(트랙 4)만 뺌 → 그대로 빠짐
const M1 =
  "MML@t116r.r<v12l24aa+v11bv10l4b+2v11b2v12ag,t116,t116v14c2&c6r12v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e.&ev9l24eff+l4g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const M2 =
  "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116,t116<v12e2&e6v9e24f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const TWO_TRACKS = "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116,t116,t116;";
// 같은 날 샘플 구간 시험: O1 착지 화음만 다른 구간(A#4·D#5·F5) → 나옴, Z2 같은 구간(C#4·D#4·G#3) → 빠짐,
// Z3 꾸밈음만 한 옥타브 위(E4 이상 구간) → 같은 구간인 E4만 빠지고 C4·G3은 나옴
const O1 =
  "MML@t116r2r6<v12a24v11b24>v12a+2<v11b2v12ag,t116,t116v14c2&c6v12c24v11d24>v12d+2<v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6v9e24f+24o5v12f2o3v9f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const Z2 =
  "MML@t116r2r6<v12a24v11b24>v12c+2<v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v12d+2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6v9e24f+24v12g+2v9f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const Z3 =
  "MML@t116r2r6v12a24v11b24v10c2<v11b2v12ag,t116,t116v14c2&c6>v12c24v11d24<v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6>v9e24f+24<g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
// 세 번째 시험(같은 날): 합 5도 빠짐. S5A 트랙 2개 × 3·2개(트랙 5는 꾸밈음 없이 쉼표 뒤 G3) → C4·G3 빠짐,
// S5B 트랙 3개 × 2·2·1개 → C4·G3 빠짐. EX62 아리아 62~63마디 원곡 조각(t114) → 화음 C5·E5·G4 셋 다 빠짐
const S5A =
  "MML@t116r.r<v12l24aa+v11bv10l4b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6r12v9g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const S5B =
  "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6r24v9f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const EX62 =
  "MML@t114>v11e2&e6<v10a24b24b+2v12b2a,t114v15a2&a6,t114l2>v15c&c6v13c24d24ev12dc4,t114,t114v14e2&e6v12e24f+24g2v10f+2e,t114o1v14l6a>a<a>v15a4&al24agf+2d2;";
// 네 번째 시험(같은 날): S4 빠른 음 2·2개(6트랙 판) → C4는 나고 G3만 빠짐. EX62 착지 음 앞 r64(33ms) → G4만 빠짐, r48(44ms) → 모두 남
const S4 =
  "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6r12v9g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const EX62FIX =
  "MML@t114>v11e2&e6<v10a24b24r64>c&c8.&c32.<v12b2a,t114v15a2&a6,t114>v15c2&c6v13c24d24r64e&e8.&e32.v12d2c,t114,t114v14e2&e6v12e24f+24r64g&g8.&g32.v10f+2e,t114o1v14l6a>a<a>v15a4&al24agf+2d2;";
const EX62R48 =
  "MML@t114>v11e2&e6<v10a24b24r48>c4&c8&c12&c48<v12b2a,t114v15a2&a6,t114>v15c2&c6v13c24d24r48e4&e8&e12&e48v12d2c,t114,t114v14e2&e6v12e24f+24r48g4&g8&g12&g48v10f+2e,t114o1v14l6a>a<a>v15a4&al24agf+2d2;";
const NO_GRACE = "MML@t116r2.v10c2<v11b2v12ag,t116,t116v14c2&c6r12v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6r12v9g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";

const AUP2 =
  "MML@t116>>r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116>>v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116>><v12a2&a6,t116>><v12e2&e6v9e24f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
/** 악보 악기만 바꾼다 */
const as = (song: Song, canonical: string): Song => ({ ...song, players: song.players.map((p) => ({ ...p, instrument: { ...p.instrument, canonical } })) });
const read = (text: string): Song => {
  const { song, diagnostics } = readMmlAt(text);
  expect(diagnostics).toEqual([]);
  return song;
};
const drops = (song: Song) => validateSong(song, MOBILE_PROFILE, { fastRunDrop: true }).filter((d) => d.code === "fast-run-drop");
/** 착지 음: 트랙 번호(1부터)와 MIDI 높이 */
const landed = (song: Song) =>
  fastRunMoments(song, MOBILE_PROFILE).map((m) =>
    m.landings.map((l) => {
      const k = song.tracks.findIndex((t) => t.id === l.trackId);
      return [k + 1, song.tracks[k]!.notes.find((n) => n.id === l.noteId)!.pitch];
    }),
  );
const at = (song: Song) => fastRunMoments(song, MOBILE_PROFILE).map((m) => `${m.at.n}/${m.at.d}`);

describe("연주 누락음 검사: 게임 녹음과 같은 판정", () => {
  it("A판(t116, 24분음표 둘 → 2분음표 화음)은 꾸밈음과 같은 구간(o3e~o4d+)의 C4·G3이 걸리고 E4는 아니다", () => {
    const song = read(A);
    expect(landed(song)).toEqual([[[1, 60], [5, 55]]]);
    expect(fastRunMoments(song, MOBILE_PROFILE)[0]!.landings.map((l) => l.zone)).toEqual([{ low: 52, high: 63 }, { low: 52, high: 63 }]);
    expect(at(song)).toEqual(["3/4"]);
    const d = drops(song);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ level: "warning", trackId: song.tracks[0]!.id, playerId: "p1", params: { tracks: 2, notes: 5, ms: 150, run: 1, gap: 40 } });
  });

  it("트랙 2개라도 같은 구간의 빠른 음이 합쳐 6개면 걸린다 (M1), 계속 울리던 같은 구간 음을 빼도 걸린다 (M2)", () => {
    expect(landed(read(M1))).toEqual([[[1, 60], [5, 55]]]);
    expect(landed(read(M2))).toEqual([[[1, 60], [5, 55]]]);
  });

  it("합 5도 걸린다: 트랙 2개 × 3·2개(S5A, 꾸밈음 없던 트랙 5의 G3 포함), 트랙 3개 × 2·2·1개(S5B)", () => {
    const s5a = read(S5A);
    expect(landed(s5a)).toEqual([[[1, 60], [5, 55]]]);
    expect(fastRunMoments(s5a, MOBILE_PROFILE)[0]!.landings.map((l) => l.run)).toEqual([3, 0]);
    expect(landed(read(S5B))).toEqual([[[1, 60], [5, 55]]]);
  });

  it("아리아 62마디 조각(EX62)은 화음 C5·E5·G4가 모두 같은 구간(o4e~o5d+)이라 셋 다 걸린다", () => {
    const song = read(EX62);
    expect(landed(song)).toEqual([[[1, 72], [3, 76], [5, 67]]]);
    expect(fastRunMoments(song, MOBILE_PROFILE)[0]!.landings.map((l) => l.zone)).toEqual(Array(3).fill({ low: 64, high: 76 }));
  });

  it("악기마다 구간이 따로다: 실로폰(o3e~o4f 한 구간)은 E4까지 걸리고, 바이올린(구간 경계 o3d·o4c)은 걸리지 않는다", () => {
    const song = read(A);
    expect(landed(as(song, "xylophone"))).toEqual([[[1, 60], [3, 64], [5, 55]]]);
    expect(landed(as(song, "violin"))).toEqual([]);
  });

  it("두 옥타브 올린 A판: 바이올린(o5c+ 이상 한 구간)은 셋 다, 플루트는 o6e 경계 아래 C6·G5만 걸린다", () => {
    const song = read(AUP2);
    expect(landed(as(song, "violin"))).toEqual([[[1, 84], [3, 88], [5, 79]]]);
    expect(landed(as(song, "flute"))).toEqual([[[1, 84], [5, 79]]]);
  });

  it("t200판(24분음표 50ms)도 걸린다", () => {
    expect(landed(read(A.replaceAll("t116", "t200")))).toEqual([[[1, 60], [5, 55]]]);
  });

  it("16분음표 둘(t116에서 129ms)도 걸린다", () => {
    expect(landed(read(SIXTEENTHS))).toEqual([[[1, 60], [5, 55]]]);
  });

  it("착지 화음을 꾸밈음과 같은 구간으로 옮긴 Z2판은 세 음 모두, 다른 구간으로 옮긴 O1판은 하나도 걸리지 않는다", () => {
    expect(landed(read(Z2))).toEqual([[[1, 61], [3, 63], [5, 56]]]);
    expect(drops(read(O1))).toEqual([]);
  });

  it("꾸밈음만 한 옥타브 위로 옮긴 Z3판은 같은 구간인 E4만 걸린다", () => {
    expect(landed(read(Z3))).toEqual([[[3, 64]]]);
  });

  it("t60판(24분음표 167ms)은 걸리지 않는다", () => {
    expect(drops(read(A.replaceAll("t116", "t60")))).toEqual([]);
  });

  it("꾸밈음 하나(빠른 음 3 + 착지 2), 트랙 2개(빠른 음 4 + 착지 1), 꾸밈음 없음, 착지 음 앞 r48(t114 44ms) 판은 걸리지 않는다", () => {
    for (const text of [ONE_GRACE, TWO_TRACKS, NO_GRACE, EX62R48]) expect(drops(read(text))).toEqual([]);
  });

  it("6트랙 판의 빠른 음 4개(S4)는 트랙 1의 C4는 남고(5번째) 트랙 5의 G3만 걸린다(6번째)", () => {
    expect(landed(read(S4))).toEqual([[[5, 55]]]);
  });

  it("착지 음 앞 틈이 40ms보다 짧으면 걸린다: r64(t116 32ms)는 38마디에선 났지만 62마디 r64(t114 33ms)에서 G4가 빠져 위험으로 본다", () => {
    expect(landed(read(R64))).toEqual([[[1, 60], [5, 55]]]);
    expect(landed(read(EX62FIX))).toEqual([[[1, 72], [3, 76], [5, 67]]]);
  });

  it("실험실을 켜지 않으면(옵션 없음) 진단하지 않는다", () => {
    expect(validateSong(read(A), MOBILE_PROFILE).some((d) => d.code === "fast-run-drop")).toBe(false);
  });

  it("규칙이 없는 프로필이면 진단하지 않는다", () => {
    const none = { ...MOBILE_PROFILE, fastRunDrop: null };
    expect(validateSong(read(A), none, { fastRunDrop: true }).some((d) => d.code === "fast-run-drop")).toBe(false);
  });
});

describe("연주 누락음 고치기", () => {
  const fixed = (song: Song) => {
    const plan = planFastRunFix(song, MOBILE_PROFILE);
    return { plan, song: setTracksNotes(plan.changes).apply(song) };
  };
  const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

  it.each([
    // t116: 1/64(32ms)가 모자라 64.(48ms). t200: 1/32(38ms)가 모자라 32.(56ms)
    ["A(t116)", A, rat(3, 128)],
    ["t200", A.replaceAll("t116", "t200"), rat(3, 64)],
    ["16분음표 둘", SIXTEENTHS, rat(3, 128)],
    ["Z2", Z2, rat(3, 128)],
    ["Z3", Z3, rat(3, 128)],
    // 빠른 음이 없던 트랙 5의 G3도 같이 늦춘다
    ["S5A", S5A, rat(3, 128)],
    ["EX62(t114)", EX62, rat(3, 128)],
  ])("%s: 착지 음만 늦추고 끝은 그대로, 고친 뒤에는 걸리지 않는다", (_name, text, by) => {
    const song = read(text);
    const before = fastRunMoments(song, MOBILE_PROFILE)[0]!;
    const { plan, song: after } = fixed(song);
    expect(plan.delays.map((d) => [d.trackId, d.by])).toEqual(before.landings.map((l) => [l.trackId, by]));
    expect(plan.delays.every((d) => d.ms >= 40)).toBe(true);
    expect(plan.skipped).toEqual({ locked: 0, short: 0, unwritable: 0, noLength: 0 });
    expect(plan.left).toBe(0);
    expect(fastRunMoments(after, MOBILE_PROFILE)).toEqual([]);
    expect(validateSong(after, MOBILE_PROFILE, { fastRunDrop: true }).some((d) => d.code === "fast-run-drop")).toBe(false);
    const landings = new Set(before.landings.map((l) => l.noteId));
    for (const t of song.tracks) {
      const next = after.tracks.find((x) => x.id === t.id)!;
      expect(next.notes).toHaveLength(t.notes.length);
      t.notes.forEach((n, k) => {
        const m = next.notes[k]!;
        expect(m.id).toBe(n.id);
        expect(eq(end(m), end(n))).toBe(true);
        if (landings.has(n.id)) {
          expect(eq(m.start, add(n.start, by))).toBe(true);
          expect(m.pitch).toBe(n.pitch);
          expect(m.vol).toBe(n.vol);
        } else {
          expect(m).toEqual(n);
        }
      });
    }
    expect(plan.chars!.delta).toBeGreaterThan(0);
    expect(plan.chars!.over).toBe(false);
    const quick = planFastRunFix(song, MOBILE_PROFILE, { quick: true, found: fastRunMoments(song, MOBILE_PROFILE) });
    expect(quick.changes).toEqual(plan.changes);
    expect(quick.chars).toBeUndefined();
    expect(quick.left).toBeUndefined();
  });

  it("늦출 길이는 그 자리 템포에서 40ms 이상인 가장 짧은 2의 거듭제곱 칸 길이 (t116 64., t200 32., t255 32.)", () => {
    const { binary, triplet } = delayLengths(MOBILE_PROFILE);
    expect(binary.slice(0, 4)).toEqual([rat(1, 64), rat(3, 128), rat(1, 32), rat(3, 64)]);
    expect(triplet[0]).toEqual(rat(1, 48));
    expect([...binary, ...triplet].some((l) => eq(l, rat(1, 37)))).toBe(false);
    const clock = (bpm: number) => tempoClock([{ at: rat(0), bpm }]);
    expect(delayFor(MOBILE_PROFILE, clock(116), rat(0))).toEqual(rat(3, 128));
    expect(delayFor(MOBILE_PROFILE, clock(200), rat(0))).toEqual(rat(3, 64));
    expect(delayFor(MOBILE_PROFILE, clock(255), rat(0))).toEqual(rat(3, 64));
  });

  it("잠근 트랙 착지 음은 늦추지 않고 까닭을 센다. 다른 두 트랙만 늦춰도 순간은 풀린다", () => {
    const song = read(Z2);
    const locked = new Set([song.tracks[2]!.id]);
    const plan = planFastRunFix(song, MOBILE_PROFILE, { locked });
    expect(plan.skipped.locked).toBe(1);
    expect(plan.delays.map((d) => d.trackId)).toEqual([song.tracks[0]!.id, song.tracks[4]!.id]);
    expect(plan.changes.map((c) => c.trackId)).not.toContain(song.tracks[2]!.id);
    expect(plan.left).toBe(0);
  });

  it("A판은 걸린 C4·G3만 늦추고 다른 구간인 E4(트랙 3)는 그대로 둔다", () => {
    const song = read(A);
    const plan = planFastRunFix(song, MOBILE_PROFILE);
    expect(plan.delays.map((d) => d.trackId)).toEqual([song.tracks[0]!.id, song.tracks[4]!.id]);
    expect(plan.left).toBe(0);
  });

  it("only로 고른 순간만 고친다", () => {
    const song = read(A);
    expect(planFastRunFix(song, MOBILE_PROFILE, { only: new Set(["없는 음"]) }).changes).toEqual([]);
    const first = fastRunMoments(song, MOBILE_PROFILE)[0]!.landings[1]!.noteId;
    expect(planFastRunFix(song, MOBILE_PROFILE, { only: new Set([first]) }).delays).toHaveLength(2);
  });
});
