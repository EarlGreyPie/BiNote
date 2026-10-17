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
});
