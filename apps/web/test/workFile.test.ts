import { describe, expect, it } from "vitest";
import { AutosaveTracker } from "../src/lib/autosave";
import { freeName, saveBaseName } from "../src/lib/saveName";
import { restoreWorkFile, sameAutosave, type AutosaveState, type WorkFile } from "../src/lib/workFile";

interface Handle {
  name: string;
}
const nameOf = (h: Handle) => h.name;

describe("restoreWorkFile: 되살린 곡의 이름과 파일", () => {
  it("저장한 것이 없으면 기록의 이름 그대로", () => {
    expect(restoreWorkFile<Handle>("a.mme", undefined, nameOf)).toEqual({ fileName: "a.mme", file: undefined, unsure: false });
  });
  it("기록의 이름과 저장한 이름·파일이 같으면 그 파일을 이어 쓴다", () => {
    const file = { name: "a.mme" };
    expect(restoreWorkFile("a.mme", { name: "a.mme", file }, nameOf)).toEqual({ fileName: "a.mme", file, unsure: false });
  });
  it("기록의 이름이 늦어 어긋나면 파일을 버리고 이름을 믿지 않는다", () => {
    expect(restoreWorkFile("a.mme", { name: "b.mme", file: { name: "b.mme" } }, nameOf)).toEqual({ fileName: "a.mme", file: undefined, unsure: true });
  });
  it("저장한 이름과 파일이 서로 다르면 믿지 않는다", () => {
    expect(restoreWorkFile("a.mme", { name: "a.mme", file: { name: "c.mme" } }, nameOf).unsure).toBe(true);
  });
});

describe("자동 보존: 이름만 바뀌어도 다시 적는다", () => {
  it("다른 이름으로 저장해 이름만 바뀌면 적을 것이 있다", () => {
    const song = {};
    const tracker = new AutosaveTracker<AutosaveState<object>>(sameAutosave);
    tracker.reset({ song, tabs: "", name: "a.mme" });
    expect(tracker.dirty({ song, tabs: "", name: "a.mme" })).toBe(false);
    expect(tracker.dirty({ song, tabs: "", name: "b.mme" })).toBe(true);
  });
});

/** 폴더 저장 흉내: 이름 없는(또는 이름을 믿을 수 없는) 곡은 같은 이름을 피한다 */
async function saveToFolder(folder: Map<string, string>, fileName: string, unsure: boolean, content: string): Promise<string> {
  const name = `${saveBaseName(fileName)}.mme`;
  const fresh = !fileName || unsure;
  const target = fresh ? await freeName(saveBaseName(fileName), ".mme", async (n) => folder.has(n)) : name;
  if (target === undefined) throw new Error("no free name");
  folder.set(target, content);
  return target;
}

describe("되살린 작업이 옛 이름으로 다른 파일을 덮어쓰지 않는다", () => {
  it("a.mme 열기 → 고침·자동 보존 → 다른 이름으로 b.mme → 닫기 → 되살려 저장해도 a.mme는 그대로", async () => {
    const folder = new Map([["a.mme", "A"]]);
    // 고친 뒤 자동 보존: 기록의 이름은 a.mme
    let recordName = "a.mme";
    // 다른 이름으로 저장: 저장할 때 이름과 파일을 적어 둔다
    folder.set("b.mme", "B");
    const stored: WorkFile<Handle> = { name: "b.mme", file: { name: "b.mme" } };
    // 이름만 바뀐 것을 자동 보존이 적지 못하고 닫혔다 (최악): 기록은 여전히 a.mme
    recordName = "a.mme";
    const restored = restoreWorkFile(recordName, stored, nameOf);
    const written = await saveToFolder(folder, restored.fileName, restored.unsure, "B2");
    expect(folder.get("a.mme")).toBe("A");
    expect(written).not.toBe("a.mme");
  });
  it("자동 보존이 새 이름을 적었으면 되살린 뒤 b.mme에 이어 쓴다", async () => {
    const folder = new Map([["a.mme", "A"], ["b.mme", "B"]]);
    const restored = restoreWorkFile("b.mme", { name: "b.mme", file: { name: "b.mme" } }, nameOf);
    expect(await saveToFolder(folder, restored.fileName, restored.unsure, "B2")).toBe("b.mme");
    expect(folder.get("a.mme")).toBe("A");
    expect(folder.get("b.mme")).toBe("B2");
  });
});
