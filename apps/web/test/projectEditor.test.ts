import { describe, expect, it } from "vitest";
import { emptySong, type Song } from "@mmlce/core";
import { readProject, writeProject } from "@mmlce/fileio";
import { editorStateKey, keepOpenMedia, keptFields, keptFit, parseEditorState, projectWriteOptions, videoFitOf, withTrackView, withVideoFit } from "../src/lib/projectEditor";

const song: Song = {
  ...emptySong({ title: "", author: "", profileId: "mobile" }),
  tracks: [{ id: "t1", playerId: "p1", name: "", color: "#000", role: "free", mute: false, solo: false, notes: [], spelling: {} }],
};

describe("parseEditorState", () => {
  it("맞는 값만 남긴다", () => {
    const state = parseEditorState(
      {
        activeTrackId: "t1",
        division: 16,
        viewMode: "tab",
        tuning: "dropD",
        capo: 2,
        reference: { name: "a.mp3", offsetMs: -120, volume: 0.8 },
        video: { name: "v.mp4", opacity: 0.5, offset: 1.5, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1 },
      },
      song,
    );
    expect(state).toEqual({
      activeTrackId: "t1",
      division: 16,
      viewMode: "tab",
      tuning: "dropD",
      capo: 2,
      reference: { name: "a.mp3", offsetMs: -120, volume: 0.8 },
      video: { name: "v.mp4", opacity: 0.5, offset: 1.5, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1 },
    });
  });

  it("악보별 튜닝은 곡에 있는 악보의 맞는 값만 남긴다", () => {
    const withPlayers: Song = { ...song, players: [{ id: "p1", name: "", instrument: { canonical: "lute" } }, { id: "p2", name: "", instrument: { canonical: "piano" } }] };
    const state = parseEditorState(
      { scoreTunings: { p1: { tuning: "bass4", capo: 0 }, p2: { tuning: "toString", capo: 1 }, gone: { tuning: "dropD", capo: 0 } } },
      withPlayers,
    );
    expect(state).toEqual({ scoreTunings: { p1: { tuning: "bass4", capo: 0 } } });
    expect(parseEditorState({ scoreTunings: { p2: { tuning: "dropD", capo: 30 } } }, withPlayers)).toEqual({});
  });

  it("잇단음 격자·길이(1/20, l20, l20.)도 받는다", () => {
    expect(parseEditorState({ division: 20, noteLength: "20" }, song)).toEqual({ division: 20, noteLength: "20" });
    expect(parseEditorState({ division: 40, noteLength: "20." }, song)).toEqual({ division: 40, noteLength: "20." });
    // 칸 하나가 게임 최단 토막(1/64)보다 짧은 격자는 받지 않는다
    expect(parseEditorState({ division: 128 }, song)).toEqual({});
    expect(parseEditorState({ division: 2.5, noteLength: "80" }, song)).toEqual({});
  });

  it("없는 트랙·모르는 격자·깨진 맞춤값은 버린다", () => {
    const state = parseEditorState(
      { activeTrackId: "gone", division: 200, viewMode: "staff", tuning: "toString", capo: -1, reference: { name: "a" }, video: { name: "v", high: 1, low: 2 } },
      song,
    );
    expect(state).toEqual({});
  });

  it("트랙 보기 상태는 있는 트랙의 숨김·잠금만 남긴다", () => {
    const state = parseEditorState({ trackView: { t1: { hidden: true, locked: "yes", extra: 1 }, gone: { locked: true } } }, song);
    expect(state).toEqual({ trackView: { t1: { hidden: true } } });
    expect(parseEditorState({ trackView: { t1: { hidden: false } } }, song)).toEqual({});
  });
});

describe("withTrackView", () => {
  it("켜고 끄며, 다 꺼진 트랙은 표에서 뺀다", () => {
    let v = withTrackView({}, "t1", { locked: true });
    expect(v).toEqual({ t1: { locked: true } });
    v = withTrackView(v, "t1", { hidden: true });
    expect(v).toEqual({ t1: { hidden: true, locked: true } });
    v = withTrackView(withTrackView(v, "t1", { locked: false }), "t1", { hidden: false });
    expect(v).toEqual({});
  });
});

describe("editorStateKey", () => {
  it("숨기기·잠그기 순서만 바뀐 상태는 같고, 값이 바뀌면 다르다", () => {
    const base = { division: 4, viewMode: "roll" as const, tuning: "standard" as const, capo: 0 };
    let ab = withTrackView({}, "a", { hidden: true });
    ab = withTrackView(ab, "b", { locked: true });
    // a를 껐다 다시 켜면 키 순서가 b, a가 된다
    const ba = withTrackView(withTrackView(ab, "a", { hidden: false }), "a", { hidden: true });
    expect(Object.keys(ab)).toEqual(["a", "b"]);
    expect(Object.keys(ba)).toEqual(["b", "a"]);
    expect(editorStateKey({ ...base, trackView: ab })).toBe(editorStateKey({ ...base, trackView: ba }));
    expect(editorStateKey({ ...base, trackView: ab })).not.toBe(editorStateKey({ ...base, trackView: withTrackView(ab, "b", { locked: false }) }));
    expect(editorStateKey({ ...base, video: { name: "v", opacity: 1, offset: 0, fit: "contain", low: 21, high: 108, keyLine: 0.9, stretch: false } as never })).not.toBe(
      editorStateKey({ ...base, video: { name: "v", opacity: 1, offset: 2, fit: "contain", low: 21, high: 108, keyLine: 0.9, stretch: false } as never }),
    );
  });
});

describe("영상 화면 채우기·잰 속도 (지시서 26)", () => {
  const song = emptySong({ title: "", author: "", profileId: "mobile" });
  const video = { name: "v.mp4", opacity: 0.5, offset: 0, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 2 };
  it("끈 화면 채우기와 잰 속도를 되살린다", () => {
    const state = parseEditorState({ video: { ...video, fill: false, speed: 120 } }, song);
    expect(state.video).toMatchObject({ fill: false, speed: 120 });
  });
  it("적지 않았으면 (옛 파일) 채우기 켬·속도 없음으로 읽는다", () => {
    const state = parseEditorState({ video }, song);
    expect(state.video?.fill).toBeUndefined();
    expect(state.video?.speed).toBeUndefined();
  });
  it("잘못된 속도는 버린다", () => {
    expect(parseEditorState({ video: { ...video, speed: -3 } }, song).video?.speed).toBeUndefined();
  });
});

describe("영상 건반 모양 (피아노 모양 끝 건반)", () => {
  const song = emptySong({ title: "", author: "", profileId: "mobile" });
  const video = { name: "v.mp4", opacity: 0.5, offset: 0, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 2 };
  it("피아노 모양은 저장하고 다시 열면 그대로 읽는다", () => {
    const saved = writeProject(song, projectWriteOptions({ video: { ...video, keyShape: "piano" } }, {}, "test"));
    expect(parseEditorState(readProject(saved).editor, song).video).toEqual({ ...video, keyShape: "piano" });
  });
  it("적지 않은 옛 파일과 모르는 값은 반음 같은 폭(칸 없음)으로 읽어 그때 맞춘 끝 건반이 그대로 맞는다", () => {
    expect(parseEditorState({ video }, song).video?.keyShape).toBeUndefined();
    expect(parseEditorState({ video: { ...video, keyShape: "round" } }, song).video?.keyShape).toBeUndefined();
  });
});

describe("연 프로젝트의 모르는 칸 다시 적기 (점검 S32)", () => {
  it("화면 상태의 모르는 칸과 맨 위 모르는 필드만 골라 둔다", () => {
    const kept = keptFields({ editor: { activeTrackId: "t1", division: 16, zoom: 2, trackView: {} }, extras: { share: { id: "abc" } } });
    expect(kept).toEqual({ file: { share: { id: "abc" } }, editor: { zoom: 2 } });
    expect(keptFields({})).toEqual({});
    expect(keptFields({ editor: { division: 8 } })).toEqual({});
  });

  it("열고 저장하면 모르는 칸이 남고, 아는 칸은 지금 화면 값이 이긴다", () => {
    const opened = writeProject(song, { editor: { activeTrackId: "t1", division: 16, zoom: 2 }, extras: { share: { id: "abc" } } });
    const read = readProject(opened);
    const kept = keptFields(read);
    const state = { ...parseEditorState(read.editor, read.song), division: 32 };
    const again = JSON.parse(writeProject(read.song, projectWriteOptions(state, kept, "test")));
    expect(again.editor).toEqual({ zoom: 2, activeTrackId: "t1", division: 32 });
    expect(again.share).toEqual({ id: "abc" });
    expect(again.app).toBe("test");
  });
});

describe("videoFitOf", () => {
  const base = { opacity: 0.5, offset: -2, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1.2 };
  it("연 영상의 맞춤값을 이름과 함께 적는다 (어긋남 포함)", () => {
    expect(videoFitOf("v.mp4", { ...base, fill: false, speed: 120, keyShape: "piano" })).toEqual({
      name: "v.mp4",
      ...base,
      fill: false,
      speed: 120,
      keyShape: "piano",
    });
  });
  it("기본값(채우기 켬·속도 없음·반음 같은 폭)은 적지 않는다", () => {
    const fit = videoFitOf("v.mp4", { ...base, fill: true, keyShape: "even" });
    expect(fit).toEqual({ name: "v.mp4", ...base });
    expect("fill" in fit || "speed" in fit || "keyShape" in fit).toBe(false);
  });
});

describe("keepOpenMedia", () => {
  it("곡을 열 때 열린 원곡·영상은 닫는다 (새 곡에 적힌 것이 없거나 다른 파일)", () => {
    expect(keepOpenMedia("a.mp3", undefined)).toBe(false);
    expect(keepOpenMedia("a.mp3", { name: "b.mp3" })).toBe(false);
  });
  it("새 곡에 같은 파일의 맞춤값이 적혀 있으면 둔다", () => {
    expect(keepOpenMedia("a.mp3", { name: "a.mp3" })).toBe(true);
  });
  it("열린 원곡을 받아 적어 만든 곡이면 둔다", () => {
    expect(keepOpenMedia("a.mp3", undefined, true)).toBe(true);
  });
  it("열린 것이 없으면 둘 것도 없다", () => {
    expect(keepOpenMedia(undefined, { name: "a.mp3" }, true)).toBe(false);
  });
});

describe("keptFit", () => {
  const fit = (name: string, offset: number) => videoFitOf(name, { opacity: 0.5, offset, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1 });
  const project = fit("b.mp4", 3);
  it("남긴 값이 없거나 같은 파일이면 방금까지 쓰던 값을 남긴다", () => {
    const live = fit("b.mp4", 1);
    expect(keptFit(undefined, live)).toBe(live);
    expect(keptFit(project, live)).toBe(live);
  });
  it("다른 파일을 열었다 빼도 곡에 적힌 원래 파일의 맞춤값은 지킨다", () => {
    expect(keptFit(project, fit("a.mp4", 1))).toBe(project);
  });
  it("열린 것이 없으면 남긴 값 그대로", () => {
    expect(keptFit(project, undefined)).toBe(project);
    expect(keptFit(undefined, undefined)).toBeUndefined();
  });
  it("원곡 맞춤값에도 같은 규칙", () => {
    const saved = { name: "song.mp3", offsetMs: 120, volume: 0.8 };
    expect(keptFit(saved, { name: "wrong.mp3", offsetMs: 0, volume: 0.8 })).toBe(saved);
    expect(keptFit(saved, { name: "song.mp3", offsetMs: 300, volume: 0.5 })).toEqual({ name: "song.mp3", offsetMs: 300, volume: 0.5 });
  });
});

describe("withVideoFit", () => {
  const open = { url: "blob:x", sound: true, handles: true, opacity: 0.5, offset: 0, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1, fill: false, speed: 80, keyShape: "piano" as const };
  it("곡에 적힌 맞춤값을 씌우고 파일·소리·손잡이는 둔다", () => {
    const fit = videoFitOf("v.mp4", { opacity: 0.7, offset: -1.5, fit: true, low: 20.5, high: 108.6, keyLine: 0.8, stretch: 1.3, speed: 120, keyShape: "piano" });
    expect(withVideoFit(open, fit)).toEqual({ url: "blob:x", sound: true, handles: true, opacity: 0.7, offset: -1.5, fit: true, low: 20.5, high: 108.6, keyLine: 0.8, stretch: 1.3, speed: 120, keyShape: "piano" });
  });
  it("적히지 않은 값(채우기 켬·속도 없음·반음 같은 폭)은 열린 영상의 값을 남기지 않는다", () => {
    const fit = videoFitOf("v.mp4", { opacity: 0.5, offset: 2, fit: false, low: 21, high: 108, keyLine: 0.85, stretch: 1 });
    const next = withVideoFit(open, fit);
    expect("fill" in next || "speed" in next || "keyShape" in next).toBe(false);
    expect(next.offset).toBe(2);
    expect(next.fit).toBe(false);
  });
});
