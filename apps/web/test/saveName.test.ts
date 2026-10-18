import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_NAME, FREE_NAME_LIMIT, freeName, saveBaseName } from "../src/lib/saveName";

describe("saveBaseName: 저장 파일 이름", () => {
  it("불러온 파일이 없으면 new project", () => {
    expect(DEFAULT_BASE_NAME).toBe("new project");
    expect(saveBaseName("")).toBe("new project");
  });
  it("확장자만 뗀다", () => {
    expect(saveBaseName("song.mme")).toBe("song");
    expect(saveBaseName("a.b.mml")).toBe("a.b");
  });
  it("확장자만 있으면 기본 이름", () => {
    expect(saveBaseName(".mme")).toBe("new project");
  });
  it("확장자가 없으면 그대로", () => {
    expect(saveBaseName("song")).toBe("song");
  });
});

describe("freeName: 폴더에 없는 첫 이름", () => {
  const inFolder = (names: string[]) => async (name: string) => names.includes(name);
  it("없으면 기본 이름", async () => {
    expect(await freeName("new project", ".mme", inFolder([]))).toBe("new project.mme");
  });
  it("있으면 2를 붙인다", async () => {
    expect(await freeName("new project", ".mme", inFolder(["new project.mme"]))).toBe("new project 2.mme");
  });
  it("1·2가 있으면 3", async () => {
    expect(await freeName("new project", ".mme", inFolder(["new project.mme", "new project 2.mme"]))).toBe("new project 3.mme");
  });
  it("다른 확장자는 따로 센다", async () => {
    expect(await freeName("new project", ".mid", inFolder(["new project.mme"]))).toBe("new project.mid");
  });
  it("상한까지 모두 있으면 있는 이름을 돌려주지 않는다 (덮어쓰지 않고 저장을 멈춘다)", async () => {
    // new project.mme, new project 2.mme … new project 999.mme가 다 있는 가짜 폴더
    const folder = new Set(Array.from({ length: FREE_NAME_LIMIT }, (_, i) => (i === 0 ? "new project.mme" : `new project ${i + 1}.mme`)));
    let asked = 0;
    const name = await freeName("new project", ".mme", async (n) => (asked++, folder.has(n)));
    expect(name).toBeUndefined();
    expect(asked).toBe(FREE_NAME_LIMIT);
  });
  it("998개만 있으면 마지막 빈 이름을 고른다", async () => {
    const folder = new Set(Array.from({ length: FREE_NAME_LIMIT - 1 }, (_, i) => (i === 0 ? "new project.mme" : `new project ${i + 1}.mme`)));
    expect(await freeName("new project", ".mme", async (n) => folder.has(n))).toBe(`new project ${FREE_NAME_LIMIT}.mme`);
  });
});
