import { describe, expect, it } from "vitest";
import { isMabiiccoPack } from "../src/index.js";

describe("isMabiiccoPack", () => {
  it("실제 팩 파일 이름: Fury 팩은 .2, Harmonic Muse 팩은 .3", () => {
    const fury = "Fury Harmonic muse Pack v1.02.dls";
    const muse = "Harmonic Muse Pack v0.25.dls";
    expect([isMabiiccoPack(2, fury), isMabiiccoPack(3, fury)]).toEqual([true, false]);
    expect([isMabiiccoPack(2, muse), isMabiiccoPack(3, muse)]).toEqual([false, true]);
    // .2 팩을 고친 팩 이름도 같은 .2
    expect(isMabiiccoPack(2, "Furika Soundpack v151.dls")).toBe(true);
    expect(isMabiiccoPack(2, "BINOTE DLS Pack v0.2.dls")).toBe(false);
    expect(isMabiiccoPack(3, "BINOTE DLS Pack v0.2.dls")).toBe(false);
  });

  it("앞뒤에 영문자가 붙은 비슷한 이름은 .2로 보지 않는다", () => {
    for (const name of ["Fury_Harmonic_Muse_v1.02.dls", "fury-pack.dls", "(Furika)151.dls", "FURY.dls"]) {
      expect(isMabiiccoPack(2, name), name).toBe(true);
    }
    for (const name of ["Furyo.dls", "Sulfury Pack.dls", "Furikake.dls"]) {
      expect(isMabiiccoPack(2, name), name).toBe(false);
    }
  });

  it(".3 이름 사이의 공백·밑줄·하이픈 변형을 알아본다", () => {
    for (const name of ["Harmonic_Muse_v0.25.dls", "Harmonic-Muse.dls", "HarmonicMuse.dls", "harmonic muse.dls"]) {
      expect(isMabiiccoPack(3, name), name).toBe(true);
    }
    for (const name of ["Fury_Harmonic_Muse_v1.02.dls", "NonharmonicMuse.dls", "Harmonic Museum.dls"]) {
      expect(isMabiiccoPack(3, name), name).toBe(false);
    }
  });
});
