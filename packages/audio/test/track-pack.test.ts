import { describe, expect, it } from "vitest";
import { assignPatches, programForPack, SoundPackRegistry, type PresetSource, type Schedule } from "../src/index.js";

// 이름이 다른 두 팩에 같은 악기(하프)가 있다
const harpPack = (program: number): PresetSource => ({
  presets: [
    { program, bankMSB: 0, name: "Harp" },
    { program: 21, bankMSB: 0, name: "Piano" },
  ],
});

function twoPacks() {
  const r = new SoundPackRegistry();
  r.add("pack-a.dls#0", "pack-a.dls", harpPack(24));
  r.add("pack-b.dls#1", "pack-b.dls", harpPack(25));
  return r;
}

describe("트랙마다 고른 사운드팩", () => {
  it("고른 팩(파일 이름)을 지금 올린 팩 id로 바꾸고, 아래 팩을 고르면 그 팩으로 찾는다", () => {
    const r = twoPacks();
    expect(r.idOfLabel("pack-b.dls")).toBe("pack-b.dls#1");
    expect(r.idOfLabel(undefined)).toBeUndefined();
    expect(r.resolve("harp")).toMatchObject({ packId: "pack-a.dls#0", bank: 0, program: 24 });
    expect(r.resolve("harp", 24, r.idOfLabel("pack-b.dls"))).toMatchObject({ packId: "pack-b.dls#1", bank: 1, program: 25 });
  });

  it("고른 팩이 지금 없으면 자동처럼 위쪽 팩에서 찾는다", () => {
    const r = twoPacks();
    expect(r.idOfLabel("gone.dls")).toBeUndefined();
    expect(r.resolve("harp", 24, r.idOfLabel("gone.dls"))).toMatchObject({ packId: "pack-a.dls#0" });
  });

  it("같은 악기라도 고른 팩이 다르면 다른 채널·다른 뱅크로 나눈다", () => {
    const r = twoPacks();
    const schedule: Schedule = {
      slots: [
        { key: "t1", instrument: "harp", program: 24 },
        { key: "t2@pack-b.dls", instrument: "harp", program: 24, pack: "pack-b.dls" },
        { key: "t3@gone.dls", instrument: "harp", program: 24, pack: "gone.dls" },
      ],
      events: [],
      duration: 0,
    };
    const { patches, unresolved } = assignPatches(schedule, r);
    expect(unresolved).toEqual([]);
    expect(patches.map((p) => [p.packId, p.bank, p.program])).toEqual([
      ["pack-a.dls#0", 0, 24],
      ["pack-b.dls#1", 1, 25],
      ["pack-a.dls#0", 0, 24],
    ]);
    expect(new Set(patches.map((p) => p.channel)).size).toBe(3);
  });
});

describe("고른 팩에 맞춘 악기 번호", () => {
  // .2·.3 판별은 파일 이름으로 하므로 기존 테스트가 쓰는 이름을 따른다
  const r = new SoundPackRegistry();
  const pack2 = r.add("p2", "Fury Harmonic muse Pack v1.02.dls", {
    presets: [
      { program: 24, bankMSB: 0, name: "Harp" },
      { program: 30, bankMSB: 0, name: "guitar" },
    ],
  });
  const pack3 = r.add("p3", "Harmonic Muse Pack v0.25.dls", { presets: [{ program: 40, bankMSB: 0, name: "Folk guitar" }] });
  const plain = r.add("pa", "pack-a.dls", { presets: [{ program: 24, bankMSB: 0, name: "Harp" }] });

  it(".3 팩을 고르면 포크 기타는 3 × 512 + 그 팩의 기타 번호, 자동으로 돌리면 팩 번호가 떨어진다", () => {
    const picked = programForPack({ canonical: "folk-guitar", packId: pack3.label }, pack3)!;
    expect(picked).toBe(3 * 512 + 40);
    expect(programForPack({ canonical: "folk-guitar", program: picked }, undefined)).toBe(40);
    // .2 팩은 같은 기타가 30번
    expect(programForPack({ canonical: "folk-guitar" }, pack2)).toBe(2 * 512 + 30);
  });

  it(".2 팩 하프는 1048, 그 밖의 팩이나 자동이면 공통 표 번호 24", () => {
    expect(programForPack({ canonical: "harp", program: 24 }, pack2)).toBe(1048);
    expect(programForPack({ canonical: "harp", program: 1048 }, plain)).toBe(24);
    expect(programForPack({ canonical: "harp", program: 1048 }, undefined)).toBe(24);
  });

  it("고른 팩에 그 악기가 없거나 번호로만 아는 악기면 번호를 그대로 둔다", () => {
    expect(programForPack({ canonical: "harp", program: 24 }, pack3)).toBe(24);
    expect(programForPack({ canonical: "mabi:1578", program: 1578 }, pack2)).toBe(1578);
    expect(programForPack({ canonical: "mabi:1578", program: 1578 }, undefined)).toBe(1578);
  });
});

describe("번호로만 아는 악기(mabi:번호)에 트랙 팩 고르기", () => {
  // .2 팩 42번 = 바이올린, .3 팩 42번 = 냥모니카. 트랙 악기는 #42.3 (1578 = 3 × 512 + 42)
  const r = new SoundPackRegistry();
  const p2 = r.add("p2", "Fury Harmonic muse Pack v1.02.dls", { presets: [{ program: 42, bankMSB: 0, name: "Violin" }] });
  const p3 = r.add("p3", "Harmonic Muse Pack v0.25.dls", { presets: [{ program: 42, bankMSB: 0, name: "Nyanmonica" }] });
  const ref = { canonical: "mabi:1578", program: 1578 };

  it(".2 팩을 고르면 재생은 .2 팩 42번이고, 저장 번호도 2 × 512 + 42 = 1066", () => {
    expect(r.resolve(ref.canonical, ref.program, r.idOfLabel(p2.label))).toMatchObject({ packId: "p2", program: 42 });
    expect(programForPack({ ...ref, packId: p2.label }, p2)).toBe(1066);
  });

  it("자동으로 되돌리면 원래 번호(공통 ID 안의 번호)로 돌아가고, 재생도 .3 팩", () => {
    expect(programForPack({ canonical: "mabi:1578", program: 1066 }, undefined)).toBe(1578);
    expect(r.resolve(ref.canonical, 1578)).toMatchObject({ packId: "p3", program: 42 });
    expect(programForPack({ ...ref, packId: p3.label }, p3)).toBe(1578);
  });
});
