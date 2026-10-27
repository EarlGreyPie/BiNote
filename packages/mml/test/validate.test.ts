import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, type Player, type Song, type Track } from "@mmlce/core";
import { parseMml, parseTrackText, validateChannel, validateSong } from "../src/index.js";

const codes = (text: string) => validateChannel(text, parseMml(text), MOBILE_PROFILE).map((d) => d.code);

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function track(id: string, text: string, playerId = "p1"): Track {
  return {
    id,
    playerId,
    name: id,
    color: "#000",
    role: "free",
    mute: false,
    solo: false,
    notes: parseTrackText(id, { text }).notes,
    spelling: {},
  };
}

function song(tracks: Track[], players: Player[] = [piano]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players, tracks };
}

describe("채널 검사", () => {
  it("한도 안이면 아무것도 없다", () => {
    expect(codes("t120 l8 v12 o4 cdef")).toEqual([]);
  });

  it("값 범위 밖은 경고, 위치를 짚는다", () => {
    const text = "t300 c128 v20 c..";
    const out = validateChannel(text, parseMml(text), MOBILE_PROFILE);
    expect(out.map((d) => d.code)).toEqual(["tempo-range", "length-range", "volume-range", "dots-range"]);
    expect(out.every((d) => d.level === "warning")).toBe(true);
    expect(text.slice(...out[0]!.span)).toBe("t300");
    expect(text.slice(...out[1]!.span)).toBe("c128");
  });

  it("글자 수 한도를 넘으면 오류, 넘친 부분을 짚는다", () => {
    const text = "c".repeat(MOBILE_PROFILE.charLimitPerScore + 5);
    const out = validateChannel(text, parseMml(text), MOBILE_PROFILE);
    expect(out[0]).toMatchObject({ level: "error", code: "char-limit", span: [2400, 2405] });
  });
});

describe("곡 검사", () => {
  it("연주자 채널 수 한도", () => {
    const tracks = Array.from({ length: 7 }, (_, i) => track(`t${i}`, "c"));
    expect(validateSong(song(tracks), MOBILE_PROFILE)).toContainEqual(
      expect.objectContaining({ code: "player-channel-limit", playerId: "p1", params: { count: 7, limit: 6 } }),
    );
  });

  it("오르골 악보의 다른 악기 트랙, 보통 악보의 축음기 트랙은 경고", () => {
    const box: Player = { id: "p1", name: "오르골", instrument: { canonical: "music-box" } };
    const own = (id: string, canonical: string) => ({ ...track(id, "c"), instrument: { canonical } });
    const codesOf = (s: Song) => validateSong(s, MOBILE_PROFILE).filter((d) => d.code.startsWith("solo")).map((d) => [d.code, d.trackId]);
    expect(codesOf(song([track("t1", "c"), own("t2", "flute"), own("t3", "music-box")], [box]))).toEqual([["solo-score-own-instrument", "t2"]]);
    expect(codesOf(song([track("t1", "c"), own("t2", "gramophone"), own("t3", "flute")]))).toEqual([["solo-instrument-track", "t2"]]);
  });

  it("음색 경계(e)를 넘는 &", () => {
    // o4d+(63) → o4e(64): 경계 64를 넘는다. o4e → o4f는 넘지 않는다
    const out = validateSong(song([track("t1", "d+&e e&f")]), MOBILE_PROFILE);
    expect(out.map((d) => [d.code, d.noteId])).toEqual([["tie-across-boundary", "t1.1"]]);
  });

  it("악기 범위 밖 음은 접혀 나는 높이를 알려 준다 (정보)", () => {
    const fold = (text: string, players?: Player[], playerId?: string) =>
      validateSong(song([track("t1", text, playerId)], players), MOBILE_PROFILE)
        .filter((d) => d.code === "pitch-fold")
        .map((d) => [d.noteId, d.params?.sounds, d.params?.octaves]);
    expect(fold("o1eo7e")).toEqual([]);
    expect(fold("o1d o0c o8b o9c")).toEqual([
      ["t1.1", "o2d", 1],
      ["t1.2", "o2c", 2],
      ["t1.3", "o6b", -2],
      ["t1.4", "o7c", -2],
    ]);
    // 고양이 하모니카는 o4a부터: o1c → o5c
    const cat: Player = { id: "p2", name: "고양이", instrument: { canonical: "cat-harmonica" } };
    expect(fold("o1c", [cat], "p2")).toEqual([["t1.1", "o5c", 4]]);
  });

  it("샘플 길이보다 길게 붙인 음은 뒷부분이 안 들린다고 알려 준다 (정보)", () => {
    const cut = (text: string) =>
      validateSong(song([track("t1", text)]), MOBILE_PROFILE)
        .filter((d) => d.code === "sample-cut")
        .map((d) => [d.noteId, d.params?.seconds]);
    // t120 피아노 o4c: 샘플 약 3.3초. 온음표(2초)는 괜찮고, 온음표 둘을 이으면(4초) 넘는다
    expect(cut("t120o4c1")).toEqual([]);
    expect(cut("t120o4c1&c1")).toEqual([["t1.1", 3.3]]);
    // 다른 음으로 붙여도 첫 음부터 잰다 (붙인 d의 샘플로 바꿔 타 실측 3.19초와 맞는다)
    expect(cut("t120o4c1&d1")).toEqual([["t1.1", 3.2]]);
    // 재생과 같은 식: 붙인 음의 샘플 구간으로 바꿔 타며 위치를 이어 간다 (감사에서 어긋났던 두 경우)
    expect(cut("t120o4d+1&e2")).toEqual([]);
    expect(cut("t120o4e1&d1")).toEqual([["t1.1", 3.9]]);
  });

  it("소리 줄어듦을 켜면 거의 안 들리게 된 뒤에도 이어지는 음을 알려 준다 (실험실, 정보)", () => {
    const guitar: Player = { id: "p1", name: "기타", instrument: { canonical: "folk-guitar" } };
    const faded = (text: string, fadeDb?: number) =>
      validateSong(song([track("t1", text)], [guitar]), MOBILE_PROFILE, fadeDb === undefined ? {} : { fadeDb })
        .filter((d) => d.code === "sample-faded" || d.code === "sample-cut")
        .map((d) => [d.code, d.params?.seconds]);
    // o5f(77)부터는 1초 안에 20dB 줄고 30dB는 약 1.65초. o4e는 4초 넘게 울린다
    expect(faded("t120o5f1", 30)).toEqual([["sample-faded", 1.7]]);
    expect(faded("t120o4e1", 30)).toEqual([]);
    // 끄면(옵션 없음) 알리지 않는다
    expect(faded("t120o5f1")).toEqual([]);
    // 샘플이 먼저 끝나면 샘플 끝만 알린다
    expect(faded("t120o5f1&f1&f1", 99)).toEqual([["sample-cut", 4.4]]);
  });

  it("소리 줄어듦을 켜면 다른 트랙이 새로 치는 음에 묻히는 긴 음과 올릴 v를 알려 준다", () => {
    const guitar: Player = { id: "p1", name: "기타", instrument: { canonical: "folk-guitar" } };
    const buried = (long: string, others: string, fadeDb: number | null = 30) =>
      validateSong(song([track("t1", long), track("t2", others)], [guitar]), MOBILE_PROFILE, fadeDb === null ? {} : { fadeDb }).filter(
        (d) => d.code === "fade-buried",
      );
    // t120 o4e 온음표 둘(4초) v6 위로 v15 8분음이 계속 친다
    const out = buried("t120v6o4e1&e1", "t120v15o5c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8");
    expect(out.map((d) => d.trackId)).toEqual(["t1"]);
    expect(out[0]!.params?.up).toBeGreaterThan(0);
    expect(out[0]!.params?.vol).toBeLessThanOrEqual(15);
    // 긴 음이 충분히 크면 알리지 않는다
    expect(buried("t120v15o4e1&e1", "t120v8o5c8c8c8c8c8c8c8c8")).toEqual([]);
    // 끄면 알리지 않는다
    expect(buried("t120v6o4e1&e1", "t120v15o5c8c8c8c8c8c8c8c8", null)).toEqual([]);
  });

  it("묻힘 알림: v0 음은 묻히지도 덮지도 않고, 이미 v15면 올리라고 하지 않는다 (beta.32 최종 점검 9·16)", () => {
    const guitar: Player = { id: "p1", name: "기타", instrument: { canonical: "folk-guitar" } };
    const diags = (texts: string[]) =>
      validateSong(song(texts.map((t, k) => track(`t${k + 1}`, t)), [guitar]), MOBILE_PROFILE, { fadeDb: 30 }).filter((d) => d.code.startsWith("fade-buried"));
    const loud = "t120v15o5c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8";
    expect(diags(["t120v0o4e1&e1", loud])).toEqual([]);
    // 무음 트랙을 더해도 결과가 같다
    const base = diags(["t120v6o4e1&e1", loud]);
    expect(diags(["t120v6o4e1&e1", loud, "t120v0o5e8e8e8e8e8e8e8e8"]).map((d) => [d.code, d.params?.db])).toEqual(base.map((d) => [d.code, d.params?.db]));
    expect(base.every((d) => Number.isFinite(d.params?.db))).toBe(true);
    const max = diags(["t120v15o4e1&e1&e1", loud + "c8c8c8c8c8c8c8c8"]);
    expect(max.length).toBeGreaterThan(0);
    expect(max.every((d) => d.code === "fade-buried-max")).toBe(true);
  });

  it("번호로만 아는 악기는 알려 준 실제 악기의 음역·샘플 길이로 잰다", () => {
    // 추가 사운드팩의 #42.3(mabi:1578)이 올린 팩에서 냥모니카로 알아봐지는 경우
    const numbered: Player = { id: "p1", name: "#42.3", instrument: { canonical: "mabi:1578" } };
    const s = song([track("t1", "t120o3c1")], [numbered]);
    const canonicalOf = (instrument: string) => (instrument === "mabi:1578" ? "cat-harmonica" : undefined);
    const out = validateSong(s, MOBILE_PROFILE, { canonicalOf });
    expect(out.map((d) => d.code)).toEqual(["pitch-fold", "sample-cut"]);
    expect(out[0]!.params?.octaves).toBe(2);
    // 알려 주지 않으면(팩이 없거나 해석 못 함) 전과 같이 기본 음역으로 잰다
    expect(validateSong(s, MOBILE_PROFILE)).toEqual([]);
    expect(validateSong(s, MOBILE_PROFILE, { canonicalOf: () => undefined })).toEqual([]);
  });

  it("트랙에서 고른 팩의 악기로 잰다: 같은 번호도 팩마다 다른 악기 (beta.19 점검)", () => {
    // .2 팩의 42번 = 바이올린, .3 팩의 42번 = 냥모니카. 팩을 고르지 않으면(자동) .3 팩 쪽으로 알아본다고 한다
    const canonicalOf = (instrument: string, _program: number | undefined, pack?: string) =>
      instrument !== "mabi:1578" ? undefined : pack === "pack-2.dls" ? "violin" : "cat-harmonica";
    const numbered: Player = { id: "p1", name: "#42", instrument: { canonical: "mabi:1578", program: 1578 } };
    const withTrackPack = (packId?: string) =>
      song([{ ...track("t1", "t120o3c1"), instrument: { canonical: "mabi:1578", program: 1578, ...(packId ? { packId } : {}) } }], [numbered]);
    // .2 팩을 고른 트랙: 재생처럼 바이올린 음역 그대로(48번 음, 2초)라 안내가 없다. 전에는 냥모니카로 재 접힘·샘플 길이를 안내했다
    expect(validateSong(withTrackPack("pack-2.dls"), MOBILE_PROFILE, { canonicalOf })).toEqual([]);
    // 팩을 고르지 않은 트랙은 전과 같다
    const auto = validateSong(withTrackPack(), MOBILE_PROFILE, { canonicalOf });
    expect(auto.map((d) => d.code)).toEqual(["pitch-fold", "sample-cut"]);
    expect(auto[0]!.params?.octaves).toBe(2);
  });

  it("음길이가 너무 복잡해 읽기를 멈춘 글도 곡 검사가 다시 넘치지 않는다", () => {
    const text = "c7c11c13c17c19c23c29c31c37c41c43c47";
    expect(() => validateSong(song([track("t1", text)]), MOBILE_PROFILE)).not.toThrow();
  });

  it("경계가 없는 악기는 보지 않는다", () => {
    const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };
    expect(validateSong(song([track("t1", "d+&e", "p2")], [flute]), MOBILE_PROFILE)).toEqual([]);
  });

  it("같은 연주자 두 채널의 같은 음 겹침은 정보", () => {
    const out = validateSong(song([track("t1", "c2"), track("t2", "r4c4")]), MOBILE_PROFILE);
    expect(out).toEqual([expect.objectContaining({ level: "info", code: "same-note-overlap", trackId: "t1" })]);
    expect(validateSong(song([track("t1", "c4"), track("t2", "r4c4")]), MOBILE_PROFILE)).toEqual([]);
  });
});
