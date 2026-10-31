import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, normalizeTempo, rat, replaceSong, type Song } from "@mmlce/core";
import { convertTempoResult, parseTrackText } from "@mmlce/mml";
import { LOCALES, translate, type MessageKey, type Params } from "@mmlce/i18n";
import { tempoAdvice } from "../src/lib/output";
import { brokenRewrittenTracks, changedTrackIds, scaleText, tempoConvertFailedText, tempoConvertNotice, tempoConvertPlan } from "../src/lib/tempoConvert";

/** 원문마다 연주자를 따로 둔 곡 (원문의 t를 곡 템포로) */
function songOf(texts: string[]): Song {
  const tracks = texts.map((text, k) => {
    const parsed = parseTrackText(`t${k + 1}`, { text });
    return {
      track: {
        id: `t${k + 1}`,
        playerId: `p${k + 1}`,
        name: `트랙${k + 1}`,
        color: "#000",
        role: "free" as const,
        mute: false,
        solo: false,
        notes: parsed.notes,
        spelling: {},
        mml: { text },
      },
      tempo: parsed.tempo,
    };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: normalizeTempo(tracks.flatMap((x) => x.tempo)),
    players: texts.map((_, k) => ({ id: `p${k + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
    tracks: tracks.map((x) => x.track),
  };
}

const range = MOBILE_PROFILE.tempo;
/** 키와 값을 그대로 보여 주는 번역 (어떤 글을 고르는지 본다) */
const raw = (key: MessageKey, params?: Params) => `${key}${params ? JSON.stringify(params) : ""}`;

describe("tempoConvertPlan: 안내 한 줄을 고칠 구간과 배율", () => {
  it("그 템포 자리부터 다음 템포 앞까지, 마지막 템포면 곡 끝까지", () => {
    const song = songOf(["t120 c4d4 t300 e4f4g4a4 t20 b4"]);
    const advice = tempoAdvice(song, range);
    expect(advice.map((a) => a.bpm)).toEqual([300, 20]);
    expect(tempoConvertPlan(song, advice[0]!, range)).toEqual({ from: rat(1, 2), to: rat(3, 2), scale: rat(1, 2) });
    expect(tempoConvertPlan(song, advice[1]!, range)).toEqual({ from: rat(3, 2), to: undefined, scale: rat(2) });
  });

  it("배율을 다 써도 범위 안에 못 들면 고칠 수 없다 (느린 쪽은 64배에서 멈춘다)", () => {
    const song: Song = { ...songOf(["c4"]), tempo: [{ at: rat(0), bpm: 0 }] };
    const [a] = tempoAdvice(song, range);
    expect(a!.to).toBeLessThan(range.min);
    expect(tempoConvertPlan(song, a!, range)).toBeUndefined();
  });

  it("배율 글: 1/2, 2", () => {
    expect(scaleText(rat(1, 2))).toBe("1/2");
    expect(scaleText(rat(4))).toBe("4");
  });
});

describe("안내대로 바꾸면", () => {
  it("그 줄이 범위 안이 되고, 실행 취소 한 번으로 바꾸기 전 곡이 된다", () => {
    const song = songOf(["t120 c4d4 t300 e4f4g4a4 t120 b4", "t120 r2 t300 c1 t120 d4"]);
    const [a] = tempoAdvice(song, range);
    const plan = tempoConvertPlan(song, a!, range)!;
    const r = convertTempoResult(song, plan.scale, plan.from, plan.to);
    expect(r.failed).toEqual([]);
    expect(tempoAdvice(r.song, range)).toEqual([]);
    expect(r.song.tempo.map((e) => e.bpm)).toEqual([120, 150, 120]);
    // App처럼 한 번 계산한 곡을 한 칸 명령으로 넣는다
    const history = new History(song);
    history.run(replaceSong("실제 시간 지키며 바꾸기", r.song));
    expect(history.song).toBe(r.song);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.song).toEqual(song);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(history.song).toBe(r.song);
  });

  it("바꾼 트랙 id: 구간 앞에서 끝난 트랙은 빼고, 사라진 트랙은 넣는다", () => {
    const song = songOf(["t120 c4", "t120 c4d4 t300 e4f4"]);
    const [a] = tempoAdvice(song, range);
    const plan = tempoConvertPlan(song, a!, range)!;
    const r = convertTempoResult(song, plan.scale, plan.from, plan.to);
    expect(changedTrackIds(song, r.song)).toEqual(["t2"]);
    expect(changedTrackIds(song, { ...song, tracks: [] })).toEqual(["t1", "t2"]);
  });

  it("다시 쓰는 트랙 원문에 문법 오류가 있으면 그 트랙 이름을 돌려준다 (App이 거절한다)", () => {
    // 트랙2의 'o' 뒤에 숫자가 없다. 트랙3은 구간 앞에서 끝나 원문을 그대로 두므로 오류가 있어도 빼낸다
    const song = songOf(["c4 t300 c4d4", "c4 o d4", "o"]);
    const [a] = tempoAdvice(song, range);
    const plan = tempoConvertPlan(song, a!, range)!;
    const r = convertTempoResult(song, plan.scale, plan.from, plan.to);
    expect(r.failed).toEqual([]);
    expect(r.song.tracks[2]).toBe(song.tracks[2]);
    expect(brokenRewrittenTracks(song, r.song)).toEqual(["트랙2"]);
    expect(brokenRewrittenTracks(song, song)).toEqual([]);
  });

  it("템포 뒤에 음이 없으면 곡이 그대로라 '바꿀 것이 없다'로 알린다", () => {
    const song = songOf(["c4 t300"]);
    const [a] = tempoAdvice(song, range);
    const plan = tempoConvertPlan(song, a!, range)!;
    expect(convertTempoResult(song, plan.scale, plan.from, plan.to).song).toBe(song);
    expect(tempoConvertNotice(song, a!, { kind: "nothing" }, 64, raw)).toEqual({ text: "ui.outputTempoConvertNothing", bad: true });
  });
});

describe("거절·완료 알림 글", () => {
  it("정확히 쓸 수 없는 길이로 거절하면 트랙 이름·마디·박·길이를 알린다", () => {
    const song = songOf(["t300 c4d64e4"]);
    const [a] = tempoAdvice(song, range);
    const plan = tempoConvertPlan(song, a!, range)!;
    const r = convertTempoResult(song, plan.scale, plan.from, plan.to);
    expect(r.song).toBe(song);
    const note = tempoConvertNotice(song, a!, { kind: "failed", result: r }, MOBILE_PROFILE.length.max, raw);
    expect(note.bad).toBe(true);
    expect(note.text).toContain("ui.outputTempoConvertFailed");
    expect(note.text).toContain("ui.outputTempoConvertLength");
    expect(note.text).toContain('\\"track\\":\\"트랙1\\"');
    expect(note.text).toContain('\\"bar\\":1,\\"beat\\":2');
    expect(note.text).toContain('\\"length\\":\\"1/128\\"');
    // 실제 문구에도 자리표시자가 남지 않는다
    for (const l of LOCALES) {
      const text = tempoConvertNotice(song, a!, { kind: "failed", result: r }, 64, (key, params) => translate(l, key, params)).text;
      expect(text, l).toContain("1/128");
      expect(text, l).not.toMatch(/\{\w+\}/);
    }
  });

  it("같은 트랙의 같은 까닭은 첫 곳만 적고, 앞 세 곳 뒤는 '외 N곳'으로 센다", () => {
    const at = (n: number) => rat(n, 4);
    const failed = [
      { kind: "length" as const, trackId: "t1", at: at(3), length: rat(1, 128), rest: false },
      { kind: "length" as const, trackId: "t1", at: at(1), length: rat(1, 128), rest: false },
      { kind: "length" as const, trackId: "t1", at: at(2), length: rat(1, 128), rest: true },
      { kind: "end" as const, trackId: "t2", at: at(4) },
      { kind: "tempo" as const, at: at(5), bpm: 150 },
      { kind: "meter" as const, at: at(0), beats: 3, unit: 32 },
    ];
    const song = songOf(["c4", "c4"]);
    const text = tempoConvertFailedText(song, failed, 64, raw);
    // 자리 순서로: 박자표(0) → 음(1/4) → 쉼표(1/2), 나머지 3곳
    const order = ["ui.outputTempoConvertMeter", "ui.outputTempoConvertLength", "ui.outputTempoConvertLengthRest", 'ui.outputTempoConvertMore{\\"count\\":3}'];
    const found = order.map((s) => text.indexOf(s));
    expect(found.every((k) => k >= 0)).toBe(true);
    expect([...found].sort((x, y) => x - y)).toEqual(found);
    expect(text).not.toContain("ui.outputTempoConvertEnd");
  });

  it("바꾸면 바꾼 템포·배율을, 반올림했으면 그것도 알린다", () => {
    const song = songOf(["t301 c4"]);
    const [a] = tempoAdvice(song, range);
    const plan = tempoConvertPlan(song, a!, range)!;
    const r = convertTempoResult(song, plan.scale, plan.from, plan.to);
    expect(r.rounded).toEqual([{ at: rat(0), bpm: 301, to: 151 }]);
    const note = tempoConvertNotice(song, a!, { kind: "done", song: r.song, result: r }, 64, (key, params) => translate("ko", key, params));
    expect(note.bad).toBe(false);
    expect(note.text).toContain("t301 구간을 t151로");
    expect(note.text).toContain("1/2배");
    expect(note.text).toContain("반올림");
  });
});
