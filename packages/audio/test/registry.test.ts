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

  it("마비꼬 추가 팩 번호(40.3 = 3 × 512 + 40)는 팩 안 번호로 찾고 .3이면 Harmonic Muse 팩을 먼저 본다", () => {
    const binote: PresetSource = { presets: [{ program: 40, bankMSB: 0, name: "Violin" }] };
    const r = new SoundPackRegistry();
    r.add("binote", "BINOTE DLS Pack v0.2.dls", binote);
    r.add("muse", "Harmonic Muse Pack v0.25.dls", muse);
    expect(r.resolve(`mabi:${3 * 512 + 40}`)).toMatchObject({ packId: "muse", program: 40, bank: 1, canonical: "folk-guitar" });
    expect(r.resolve(`mabi:${3 * 512 + 42}`)).toMatchObject({ packId: "muse", program: 42, canonical: "cat-harmonica" });
    // 팩마다 같은 번호가 다른 악기일 수 있으므로 다른 팩의 40번(바이올린)으로 넘어가지 않는다
    expect(r.resolve(`mabi:${3 * 512 + 41}`)).toBeUndefined();
    r.remove("muse");
    expect(r.resolve(`mabi:${3 * 512 + 40}`)).toBeUndefined();
    // 트랙에서 직접 고른 팩이면 그 팩의 번호를 쓴다
    expect(r.resolve(`mabi:${3 * 512 + 40}`, undefined, "binote")).toMatchObject({ packId: "binote", program: 40 });
  });

  it("공통 ID로 읽힌 추가 팩 악기(하프 24.2)도 팩 번호에 맞는 팩을 먼저 보고, 없으면 다른 팩의 같은 악기로", () => {
    const harp = (name: string): PresetSource => ({ presets: [{ program: 24, bankMSB: 0, name }] });
    const r = new SoundPackRegistry();
    r.add("binote", "BINOTE DLS Pack v0.2.dls", harp("Harp"));
    r.add("furika", "Furika Soundpack v151.dls", harp("Harp"));
    r.add("muse", "Harmonic Muse Pack v0.25.dls", harp("Harp"));
    expect(r.resolve("harp", 2 * 512 + 24)).toMatchObject({ packId: "furika" });
    expect(r.resolve("harp", 3 * 512 + 24)).toMatchObject({ packId: "muse" });
    expect(r.resolve("harp", 24)).toMatchObject({ packId: "binote" });
    r.remove("furika");
    expect(r.resolve("harp", 2 * 512 + 24)).toMatchObject({ packId: "binote" });
  });

  it("이름에 Harmonic muse가 들어간 Fury 팩은 .3으로 보지 않는다", () => {
    const r = new SoundPackRegistry();
    r.add("fury", "Fury Harmonic muse Pack v1.02.dls", { presets: [{ program: 40, bankMSB: 0, name: "Folk guitar" }] });
    expect(r.resolve(`mabi:${3 * 512 + 40}`)).toBeUndefined();
    r.add("muse", "Harmonic Muse Pack v0.25.dls", muse);
    expect(r.resolve(`mabi:${3 * 512 + 40}`)).toMatchObject({ packId: "muse" });
  });
});
