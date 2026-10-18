import { describe, expect, it } from "vitest";
import { confirmedSave, projectRoute, saveProjectFile, type ProjectSaveDeps, type SavedFile } from "../src/lib/projectSave";

describe("projectRoute: 프로젝트 저장의 길", () => {
  const base = { hasFile: false, saveAs: false, asks: true, canAsk: true };
  it("기억한 파일이 있고 저장할 때마다 고르기면 바로 쓴다", () => {
    expect(projectRoute({ ...base, hasFile: true })).toBe("direct");
  });
  it("기억한 파일이 없으면 저장 방식대로", () => {
    expect(projectRoute(base)).toBe("target");
  });
  it("다른 이름으로 저장은 기억한 파일이 있어도 언제나 저장 창", () => {
    expect(projectRoute({ ...base, hasFile: true, saveAs: true })).toBe("dialog");
    expect(projectRoute({ ...base, saveAs: true, asks: false })).toBe("dialog");
  });
  it("폴더·다운로드 방식은 기억한 파일이 있어도 저장 방식대로", () => {
    expect(projectRoute({ ...base, hasFile: true, asks: false })).toBe("target");
  });
  it("저장 창을 못 띄우는 브라우저의 다른 이름으로 저장은 저장 방식대로", () => {
    expect(projectRoute({ ...base, saveAs: true, asks: false, canAsk: false })).toBe("target");
  });
});

/** 가짜 파일 핸들 */
interface Fake {
  name: string;
  broken?: boolean;
  data?: string;
}

function deps(picked: Fake | "cancelled" | undefined) {
  const log: string[] = [];
  const d: ProjectSaveDeps<Fake> = {
    write: async (f, bytes) => {
      log.push(`write ${f.name}`);
      if (f.broken) return false;
      f.data = new TextDecoder().decode(bytes);
      return true;
    },
    ask: async (name) => {
      log.push(`ask ${name}`);
      return picked === "cancelled" ? "cancelled" : { file: picked };
    },
    target: async (_b, name): Promise<SavedFile<Fake>> => {
      log.push(`target ${name}`);
      return { outcome: "downloaded" };
    },
    download: (_b, name) => log.push(`download ${name}`),
    nameOf: (f) => f.name,
  };
  return { d, log };
}

const bytes = new TextEncoder().encode("project");
const asking = { saveAs: false, asks: true, canAsk: true };

describe("saveProjectFile: 바로 쓰기와 물러나기", () => {
  it("기억한 파일에 창 없이 바로 쓴다", async () => {
    const file: Fake = { name: "song.mme" };
    const { d, log } = deps(undefined);
    const saved = await saveProjectFile(bytes, "song.mme", { file, ...asking }, d);
    expect(saved).toEqual({ outcome: "written", name: "song.mme", file });
    expect(file.data).toBe("project");
    expect(log).toEqual(["write song.mme"]);
  });
  it("바로 쓰지 못하면(createWritable 실패 등) 저장 창으로 물러나 고른 파일에 쓴다", async () => {
    const file: Fake = { name: "song.mme", broken: true };
    const other: Fake = { name: "other.mme" };
    const { d, log } = deps(other);
    const saved = await saveProjectFile(bytes, "song.mme", { file, ...asking }, d);
    expect(saved).toEqual({ outcome: "written", name: "other.mme", file: other, directFailed: true });
    expect(log).toEqual(["write song.mme", "ask song.mme", "write other.mme"]);
  });
  it("물러난 저장 창도 못 띄우면 다운로드로 저장하고 알린다", async () => {
    const { d, log } = deps(undefined);
    const saved = await saveProjectFile(bytes, "song.mme", { file: { name: "song.mme", broken: true }, ...asking }, d);
    expect(saved).toEqual({ outcome: "downloaded", directFailed: true });
    expect(log.at(-1)).toBe("download song.mme");
  });
  it("물러난 저장 창을 닫으면 저장하지 않았다고 알린다 (조용히 건너뛰지 않는다)", async () => {
    const { d } = deps("cancelled");
    const saved = await saveProjectFile(bytes, "song.mme", { file: { name: "song.mme", broken: true }, ...asking }, d);
    expect(saved).toEqual({ outcome: "cancelled", directFailed: true });
  });
  it("저장 창에서 고른 파일에도 못 쓰면 다운로드로 (rescued)", async () => {
    const { d, log } = deps({ name: "bad.mme", broken: true });
    const saved = await saveProjectFile(bytes, "song.mme", { file: undefined, ...asking, saveAs: true }, d);
    expect(saved).toEqual({ outcome: "rescued" });
    expect(log).toEqual(["ask song.mme", "write bad.mme", "download song.mme"]);
  });
  it("다른 이름으로 저장은 기억한 파일에 쓰지 않고 저장 창을 띄운다", async () => {
    const file: Fake = { name: "song.mme" };
    const copy: Fake = { name: "copy.mme" };
    const { d, log } = deps(copy);
    const saved = await saveProjectFile(bytes, "song.mme", { file, ...asking, saveAs: true }, d);
    expect(saved).toEqual({ outcome: "written", name: "copy.mme", file: copy });
    expect(file.data).toBeUndefined();
    expect(log).toEqual(["ask song.mme", "write copy.mme"]);
  });
  it("기억한 파일이 없으면 저장 방식대로", async () => {
    const { d, log } = deps(undefined);
    expect(await saveProjectFile(bytes, "new project.mme", { file: undefined, ...asking }, d)).toEqual({ outcome: "downloaded" });
    expect(log).toEqual(["target new project.mme"]);
  });
  it("폴더 방식이면 기억한 파일이 있어도 저장 방식대로", async () => {
    const file: Fake = { name: "song.mme" };
    const { d, log } = deps(undefined);
    await saveProjectFile(bytes, "song.mme", { file, saveAs: false, asks: false, canAsk: true }, d);
    expect(log).toEqual(["target song.mme"]);
    expect(file.data).toBeUndefined();
  });
});

describe("confirmedSave: 확인된 프로젝트 저장 표식", () => {
  const before = { song: "A" };
  const now = { song: "A" };
  /** App의 savedAsProject와 같은 판정: 표식이 있고 지금 곡이 그 곡이면 */
  const savedAsProject = (mark: { song: string } | undefined, song: string) => !!mark && mark.song === song;

  it("바로 쓰기 실패 → 저장 창 닫음이면 전에 확인한 저장도 지운다 (업데이트가 옛 저장을 믿지 않게)", () => {
    const mark = confirmedSave(before, { outcome: "cancelled", directFailed: true }, now);
    expect(mark).toBeUndefined();
    expect(savedAsProject(mark, "A")).toBe(false);
  });
  it("바로 쓰기 실패 → 다운로드도 지운다", () => {
    expect(confirmedSave(before, { outcome: "downloaded", directFailed: true }, now)).toBeUndefined();
  });
  it("바로 쓰기 실패 → 저장 창에서 고른 파일에 썼으면 새 저장으로 다시 세운다", () => {
    expect(confirmedSave(before, { outcome: "written", name: "b.mme", directFailed: true }, now)).toBe(now);
  });
  it("그냥 저장 창을 닫거나 다시 저장하라고 했으면 그대로", () => {
    expect(confirmedSave(before, { outcome: "cancelled" }, now)).toBe(before);
    expect(confirmedSave(before, { outcome: "retry" }, now)).toBe(before);
  });
  it("다운로드·rescued는 지우고 written·shared는 세운다", () => {
    expect(confirmedSave(before, { outcome: "downloaded" }, now)).toBeUndefined();
    expect(confirmedSave(before, { outcome: "rescued" }, now)).toBeUndefined();
    expect(confirmedSave(undefined, { outcome: "shared" }, now)).toBe(now);
  });
});
