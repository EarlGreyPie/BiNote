import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import {
  migrateProject,
  PROJECT_MIGRATIONS,
  PROJECT_MIN_READER,
  PROJECT_VERSION,
  readProject,
  writeProject,
  type ProjectMigration,
  type ProjectReadResult,
} from "../src/index.js";

// 판마다 고정한 샘플 파일. 한 번 넣은 파일은 고치지 않는다 (그 판 앱이 실제로 쓴 모양을 계속 열 수 있는지 본다)
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
/** 1.0.0-beta.32가 저장한 파일 (minReader 없음) */
const BETA32 = fixture("v1-beta32.mme");
/** 더 새 판(2)이 판 1도 읽을 수 있다고 적어 저장한 파일. 곳곳에 이 판이 모르는 필드가 있다 */
const FUTURE = fixture("v2-future.mme");

/** 읽은 그대로 다시 쓴다 (열고 저장만 한 것) */
function resave(read: ProjectReadResult, raw: { app?: string; savedAt?: string }): string {
  return writeProject(read.song, {
    editor: read.editor,
    ...(raw.app ? { app: raw.app } : {}),
    ...(raw.savedAt ? { savedAt: new Date(raw.savedAt) } : {}),
    ...(read.extras ? { extras: read.extras } : {}),
  });
}

describe("프로젝트 판: beta.32 고정 샘플", () => {
  it("beta.32 파일을 문제없이 열고, 다시 쓰면 minReader 한 줄만 더해진다", () => {
    const read = readProject(BETA32);
    expect(read.diagnostics).toEqual([]);
    expect(read.extras).toBeUndefined();
    const { song } = read;
    expect(song.extras).toBeUndefined();
    // 판마다 늘어난 필드가 그대로 들어온다
    expect(song.tracks[0]!.notes[0]!.start).toEqual(rat(-1, 8));
    expect(song.tracks[0]!.colorPinned).toBe(true);
    expect(song.tracks[0]!.notes[3]!.lab).toEqual({ kind: "ghost", vol: 9 });
    expect(song.players[1]!.tab).toEqual({ tuning: "custom", capo: 2, strings: [64, 59, 55, 50, 45, 38] });
    expect(song.made!.map((r) => r.id)).toEqual(["mk1"]);
    expect(song.sources.map((s) => s.kind)).toEqual(["audio", "midi"]);

    const raw = JSON.parse(BETA32) as { app: string; savedAt: string };
    const expected = BETA32.replace(`"version": 1,\n`, `"version": 1,\n  "minReader": 1,\n`);
    expect(expected).not.toBe(BETA32);
    expect(resave(read, raw)).toBe(expected);
  });

  it("새로 쓴 파일도 beta.32가 연다: version은 1 그대로이고 맨 위에는 minReader만 더한다", () => {
    // beta.32는 version > 1이면 거부하고 모르는 필드는 건너뛴다. version을 올리면 beta.32에서 열리지 않는다
    expect(PROJECT_VERSION).toBe(1);
    expect(PROJECT_MIN_READER).toBe(1);
    const written = JSON.parse(writeProject(readProject(BETA32).song)) as Record<string, unknown>;
    expect(written.version).toBe(1);
    const old = Object.keys(JSON.parse(BETA32) as object);
    expect(Object.keys(written).filter((k) => !old.includes(k))).toEqual(["minReader"]);
  });
});

describe("프로젝트 판: 모르는 필드 보존", () => {
  it("더 새 판 파일은 minReader가 이 판 이하면 경고와 함께 연다", () => {
    const read = readProject(FUTURE);
    expect(read.diagnostics.map((d) => [d.code, d.params])).toEqual([["project-newer-open", { version: 2 }]]);
    const { song } = read;
    expect(read.extras).toEqual({ share: { id: "abc" } });
    expect(song.extras).toEqual({ chords: [{ at: { n: 0, d: 1 }, name: "Am" }] });
    expect(song.meta.extras).toEqual({ key: "Am" });
    expect(song.markers[0]!.extras).toEqual({ color: "#ff0000" });
    expect(song.players[0]!.extras).toEqual({ hand: "left" });
    expect(song.tracks[0]!.extras).toEqual({ lyrics: ["가", "나"] });
    expect(song.tracks[0]!.notes[0]!.extras?.bend).toEqual({ cents: 50 });
    expect(song.tracks[0]!.notes[1]!.extras).toBeUndefined();
    expect(song.sources[0]!.extras).toEqual({ gainDb: -3 });
    expect(song.made![0]!.before[0]!.notes[0]!.extras).toEqual({ bend: { cents: -20 } });
    // 아는 필드는 평소대로 읽는다
    expect(song.tracks[0]!.notes.map((n) => n.pitch)).toEqual([60, 62]);
    expect(read.editor).toEqual({ activeTrackId: "t1", division: 16, zoom: 2 });
  });

  it("열고 저장만 해도 모르는 필드가 사라지지 않는다 (판은 이 앱 판으로 적는다)", () => {
    const raw = JSON.parse(FUTURE) as { app: string; savedAt: string };
    const read = readProject(FUTURE);
    const again = JSON.parse(resave(read, raw)) as Record<string, unknown>;
    expect(again).toEqual({ ...JSON.parse(FUTURE), version: PROJECT_VERSION, minReader: PROJECT_MIN_READER });
    // 다시 연 파일은 이 판이 쓴 것이라 경고 없이 열리고, 모르는 필드도 그대로다
    const back = readProject(JSON.stringify(again));
    expect(back.diagnostics).toEqual([]);
    expect(back.song.tracks[0]!.extras).toEqual({ lyrics: ["가", "나"] });
  });

  it("__proto__ 같은 이름도 그냥 필드로 들고 있고 다른 객체를 더럽히지 않는다", () => {
    const read = readProject(FUTURE);
    const note = read.song.tracks[0]!.notes[0]!;
    expect(Object.hasOwn(note.extras!, "__proto__")).toBe(true);
    expect((note as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const written = writeProject(read.song);
    expect(written).toContain(`"__proto__":{"polluted":true}`);
  });

  it("고친 음에도 모르는 필드가 따라가고, 아는 필드 이름은 extras가 덮지 못한다", () => {
    const { song } = readProject(FUTURE);
    const track = song.tracks[0]!;
    const n1 = track.notes[0]!;
    const edited = { ...song, tracks: [{ ...track, notes: [{ ...n1, pitch: 61, extras: { ...n1.extras, pitch: 1, vol: 1 } }, track.notes[1]!] }] };
    const back = JSON.parse(writeProject(edited)) as { song: { tracks: { notes: Record<string, unknown>[] }[] } };
    const note = back.song.tracks[0]!.notes[0]!;
    expect(note.pitch).toBe(61);
    expect(note.vol).toBe(12);
    expect(note.bend).toEqual({ cents: 50 });
    expect(note.extras).toBeUndefined();
  });

  it("아는 필드를 뺀 판 1 파일의 모르는 필드도 그대로 둔다 (판을 올리지 않고 필드를 더한 앞 판)", () => {
    const raw = JSON.parse(BETA32);
    raw.song.tracks[1].notes[0].vibrato = 3;
    raw.song.players[0].seat = 2;
    raw.extraTop = true;
    const read = readProject(JSON.stringify(raw));
    expect(read.diagnostics).toEqual([]);
    const again = JSON.parse(resave(read, raw));
    expect(again).toEqual({ ...raw, minReader: 1 });
  });

  it("템포·박자 변화와 만든 기록의 모르는 필드도 남는다", () => {
    const raw = JSON.parse(BETA32);
    raw.song.tempo[1].curve = "linear";
    raw.song.timeSig[0].hidden = true;
    raw.song.made[0].memo = { by: "앞 판" };
    const read = readProject(JSON.stringify(raw));
    expect(read.diagnostics).toEqual([]);
    expect(read.song.tempo[1]!.extras).toEqual({ curve: "linear" });
    expect(read.song.timeSig[0]!.extras).toEqual({ hidden: true });
    expect(read.song.made![0]!.extras).toEqual({ memo: { by: "앞 판" } });
    expect(JSON.parse(resave(read, raw))).toEqual({ ...raw, minReader: 1 });
  });
  it("아는 필드 안 객체(악기·타브·원문·소리 섞기·맞춤법·실험실 표시)의 모르는 필드도 남는다", () => {
    const raw = JSON.parse(FUTURE);
    const player = raw.song.players[0];
    player.instrument = { ...player.instrument, futureOption: { enabled: true } };
    player.tab = { tuning: "standard", capo: 0, futureFret: 3 };
    const track = raw.song.tracks[0];
    track.mml = { text: "c3d6", offset: { n: 0, d: 1 }, futureText: "x" };
    track.instrument = { canonical: "harp", futureVoice: 2 };
    track.mix = { volume: 100, futurePan: "wide" };
    track.spelling = { defaultLength: 8, futureSpelling: true };
    track.notes[1].lab = { kind: "ghost", vol: 3, futureLab: 1 };
    const read = readProject(JSON.stringify(raw));
    // 모델에는 아는 필드만 들어온다 (다른 코드가 모르는 필드를 볼 일이 없다)
    expect(read.song.players[0]!.instrument).toEqual({ canonical: "lute" });
    expect(read.song.tracks[0]!.mml).toEqual({ text: "c3d6", offset: rat(0) });
    const again = JSON.parse(resave(read, raw));
    expect(again.song.players[0].instrument.futureOption).toEqual({ enabled: true });
    expect(again.song.players[0].tab.futureFret).toBe(3);
    const t = again.song.tracks[0];
    expect(t.mml.futureText).toBe("x");
    expect(t.instrument).toEqual({ canonical: "harp", futureVoice: 2 });
    expect(t.mix.futurePan).toBe("wide");
    expect(t.spelling.futureSpelling).toBe(true);
    expect(t.notes[1].lab.futureLab).toBe(1);
    // 안쪽 칸 이름은 파일에 적지 않는다
    expect(JSON.stringify(again)).not.toContain("\\u0000");
  });

  it("앱이 버린 안쪽 객체는 모르는 필드만으로 되살리지 않고, 아는 필드는 덮지 못한다", () => {
    const raw = JSON.parse(FUTURE);
    raw.song.players[0].tab = { tuning: "standard", capo: 0, futureFret: 3 };
    raw.song.players[0].instrument = { canonical: "lute", futureOption: 1 };
    const read = readProject(JSON.stringify(raw));
    const { tab: _tab, ...noTab } = read.song.players[0]!;
    const song = { ...read.song, players: [{ ...noTab, instrument: { canonical: "harp" } }, ...read.song.players.slice(1)] };
    const again = JSON.parse(writeProject(song));
    expect(again.song.players[0].tab).toBeUndefined();
    expect(again.song.players[0].instrument).toEqual({ canonical: "harp", futureOption: 1 });
  });
});

describe("프로젝트 판: 더 새 판 거부", () => {
  it("minReader가 없거나 이 판보다 크거나 맞지 않는 값이면 지금처럼 열지 않는다", () => {
    const raw = JSON.parse(FUTURE);
    for (const minReader of [undefined, PROJECT_VERSION + 1, 0, 1.5, "1", null]) {
      const file = { ...raw, minReader };
      if (minReader === undefined) delete file.minReader;
      expect(() => readProject(JSON.stringify(file)), String(minReader)).toThrowError(expect.objectContaining({ code: "project-newer", params: { version: 2 } }));
    }
  });

  it("이 판 이하 파일은 minReader가 엉뚱해도 그대로 연다 (쓴 앱이 이 판을 모를 수 없다)", () => {
    const raw = JSON.parse(BETA32);
    raw.minReader = 7;
    expect(readProject(JSON.stringify(raw)).diagnostics).toEqual([]);
  });
});

describe("프로젝트 판: 판 올림 사슬", () => {
  it("사슬 길이는 판 수와 맞는다 (판을 올리면 올림을 한 칸 더한다)", () => {
    expect(PROJECT_MIGRATIONS.length).toBe(PROJECT_VERSION - 1);
  });

  it("한 판씩 차례로 올린다", () => {
    const steps: ProjectMigration[] = [
      (raw) => ({ ...raw, version: 2, song: { ...(raw.song as object), renamed: (raw.song as { old: number }).old } }),
      (raw) => ({ ...raw, version: 3, seen: [...((raw.seen as number[] | undefined) ?? []), (raw.song as { renamed: number }).renamed] }),
    ];
    expect(migrateProject({ version: 1, song: { old: 5 } }, 1, 3, steps)).toEqual({ version: 3, song: { old: 5, renamed: 5 }, seen: [5] });
    expect(migrateProject({ version: 2, song: { renamed: 7 } }, 2, 3, steps)).toEqual({ version: 3, song: { renamed: 7 }, seen: [7] });
    const same = { version: 3 };
    expect(migrateProject(same, 3, 3, steps)).toBe(same);
  });

  it("빠진 올림이 있으면 조용히 넘어가지 않는다", () => {
    expect(() => migrateProject({ version: 1 }, 1, 3, [(raw) => ({ ...raw, version: 2 })])).toThrow();
  });
});
