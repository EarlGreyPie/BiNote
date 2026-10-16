import { describe, expect, it } from "vitest";
import { SoundPackRegistry, type PresetSource } from "../src/index.js";

// 실제 팩의 프리셋 이름·번호 구성을 흉내 낸 가짜 사운드뱅크 (사운드팩 파일 자체는 저장소에 넣지 않는다)
const fury: PresetSource = {
  presets: [
    { program: 0, bankMSB: 0, name: "Lute" },
    { program: 21, bankMSB: 0, name: "Piano" },
    { program: 30, bankMSB: 0, name: "guitar" },
    { program: 31, bankMSB: 0, name: "harmonica_" },
    { program: 33, bankMSB: 0, name: "(Not Used)" },
  ],
};
const muse: PresetSource = {
  presets: [
    { program: 21, bankMSB: 0, name: "Piano" },
    { program: 40, bankMSB: 0, name: "Folk guitar" },
    { program: 42, bankMSB: 0, name: "Nyanmonica" },
  ],
};

describe("SoundPackRegistry", () => {
  it("팩마다 다른 뱅크를 주고 이름으로 공통 ID를 붙인다", () => {
    const r = new SoundPackRegistry();
    const a = r.add("fury", "Fury v1.02", fury);
    const b = r.add("muse", "Harmonic Muse v0.25", muse);
    expect([a.bank, b.bank]).toEqual([0, 1]);
    expect(a.instruments.map((i) => i.canonical)).toEqual(["lute", "piano", "folk-guitar", "harmonica"]);
  });

  it("번호가 달라도 같은 악기를 찾는다", () => {
    const r = new SoundPackRegistry();
    r.add("fury", "", fury);
    r.add("muse", "", muse);
    expect(r.resolve("folk-guitar")).toMatchObject({ packId: "fury", program: 30, bank: 0 });
    expect(r.resolve("folk-guitar", undefined, "muse")).toMatchObject({ packId: "muse", program: 40, bank: 1 });
    expect(r.resolve("cat-harmonica")).toMatchObject({ packId: "muse", program: 42 });
  });

  it("우선순위를 바꾸면 앞 팩에서 먼저 찾는다", () => {
    const r = new SoundPackRegistry();
    r.add("fury", "", fury);
    r.add("muse", "", muse);
    r.setOrder(["muse", "fury"]);
    expect(r.resolve("piano")).toMatchObject({ packId: "muse", bank: 1 });
  });

  it("mabi:번호는 번호로 찾고, 없으면 undefined", () => {
    const r = new SoundPackRegistry();
    r.add("fury", "", fury);
    expect(r.resolve("mabi:31")).toMatchObject({ program: 31 });
    expect(r.resolve("mabi:99")).toBeUndefined();
    expect(r.resolve("violin")).toBeUndefined();
  });
});
