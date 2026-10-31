import { describe, expect, it } from "vitest";
import { DragDepth, draggingFiles, draggingText, launchedFiles, launchQueueOf, planIncoming, type NamedFile } from "../src/lib/fileDrop";

const SCORES = ".mme,.mmlce,.mml,.mmi,.txt,.mid,.midi,.musicxml,.mxl";
const PACKS = ".dls,.sf2,.sf3";
const f = (name: string, type = ""): NamedFile => ({ name, type });
const plan = (files: NamedFile[]) => planIncoming(files, (x) => x, { scores: SCORES, packs: PACKS });

describe("planIncoming", () => {
  it("악보·원곡·사운드팩을 나눈다", () => {
    const song = f("곡.MME");
    const audio = f("원곡.mp3", "audio/mpeg");
    const pack = f("pack.sf2");
    const out = plan([audio, pack, song]);
    expect(out.score).toBe(song);
    expect(out.reference).toBe(audio);
    expect(out.packs).toEqual([pack]);
    expect(out.skipped).toEqual([]);
  });

  it("악보와 원곡은 처음 것 하나만 열고 나머지는 건너뛴다", () => {
    const a = f("a.mml");
    const b = f("b.mid", "audio/midi");
    const v1 = f("v1.mp4", "video/mp4");
    const v2 = f("v2.webm", "video/webm");
    const out = plan([a, v1, b, v2]);
    expect(out.score).toBe(a);
    expect(out.reference).toBe(v1);
    expect(out.skipped).toEqual([b, v2]);
  });

  it(".mid는 형식이 audio/midi라도 원곡이 아니라 악보로 연다", () => {
    const midi = f("song.mid", "audio/midi");
    expect(plan([midi])).toMatchObject({ score: midi, skipped: [] });
    expect(plan([midi]).reference).toBeUndefined();
  });

  it("형식이 비어 와도(안드로이드 공유) 확장자로 원곡을 알아본다", () => {
    const wav = f("rec.WAV");
    expect(plan([wav]).reference).toBe(wav);
  });

  it("사운드팩은 놓은 만큼 올리고, 모르는 형식은 건너뛴다", () => {
    const p1 = f("a.dls");
    const p2 = f("b.sf3");
    const doc = f("readme.pdf", "application/pdf");
    const out = plan([p1, doc, p2]);
    expect(out.packs).toEqual([p1, p2]);
    expect(out.skipped).toEqual([doc]);
    expect(out.score).toBeUndefined();
  });

  it("빈 목록이면 할 일이 없다", () => {
    expect(plan([])).toEqual({ packs: [], skipped: [] });
  });
});

describe("draggingFiles", () => {
  it("파일을 끌 때만 true (글만 끌면 false)", () => {
    expect(draggingFiles(["Files"])).toBe(true);
    expect(draggingFiles(["text/plain", "Files"])).toBe(true);
    expect(draggingFiles(["text/plain"])).toBe(false);
    expect(draggingFiles(undefined)).toBe(false);
  });
});

describe("draggingText", () => {
  it("파일 없이 글만 끌 때만 true (편집 칸 밖에 MML@ 글을 놓으려면 dragover부터 받아야 한다)", () => {
    expect(draggingText(["text/plain"])).toBe(true);
    expect(draggingText(["text/html", "text/plain"])).toBe(true);
    expect(draggingText(["text/plain", "Files"])).toBe(false);
    expect(draggingText(["Files"])).toBe(false);
    expect(draggingText(["text/uri-list"])).toBe(false);
    expect(draggingText(undefined)).toBe(false);
  });
});

describe("DragDepth", () => {
  it("안쪽 요소를 지나는 dragenter·dragleave 짝에도 꺼지지 않는다", () => {
    const d = new DragDepth();
    expect(d.enter()).toBe(true); // 창 안으로
    expect(d.enter()).toBe(true); // 안쪽 요소로
    expect(d.leave()).toBe(true); // 바깥 요소를 떠남
    expect(d.leave()).toBe(false); // 창 밖으로
    expect(d.leave()).toBe(false); // 짝이 어긋나도 음수가 되지 않는다
    expect(d.enter()).toBe(true);
    expect(d.reset()).toBe(false);
    expect(d.leave()).toBe(false);
  });
});

describe("launchQueue", () => {
  it("launchQueue가 없는 브라우저는 undefined", () => {
    expect(launchQueueOf({})).toBeUndefined();
    expect(launchQueueOf(undefined)).toBeUndefined();
    const queue = { setConsumer: () => {} };
    expect(launchQueueOf({ launchQueue: queue })).toBe(queue);
  });

  it("넘겨받은 것 가운데 읽히는 파일만 꺼낸다 (폴더·읽기 실패는 건너뛴다)", async () => {
    const file = new File(["MML@"], "a.mme");
    const ok = { kind: "file", name: "a.mme", getFile: () => Promise.resolve(file) };
    const dir = { kind: "directory", name: "dir" };
    const gone = { kind: "file", name: "b.mml", getFile: () => Promise.reject(new Error("NotFoundError")) };
    const out = await launchedFiles({ files: [ok, dir, gone] as unknown as FileSystemHandle[] });
    expect(out).toHaveLength(1);
    expect(out[0]!.file).toBe(file);
    expect(out[0]!.handle).toBe(ok);
    expect(await launchedFiles({})).toEqual([]);
  });
});
