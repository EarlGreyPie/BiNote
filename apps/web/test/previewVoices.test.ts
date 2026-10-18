import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE } from "@mmlce/core";
import { previewPitch } from "../src/lib/instrumentRange";
import { PreviewVoices } from "../src/lib/previewVoices";

/** 엔진의 미리듣기처럼 신스를 부른다: 누를 때 끌 음을 먼저 끄고 접은 높이를 켠다. 호출을 차례로 적는다 */
function fakeEngine() {
  const calls: string[] = [];
  const voices = new PreviewVoices();
  return {
    calls,
    on(instrument: string, pitch: number) {
      const sent = previewPitch(MOBILE_PROFILE, instrument, pitch);
      for (const p of voices.press(pitch, sent)) calls.push(`off ${p}`);
      calls.push(`on ${sent}`);
    },
    off(pitch: number) {
      for (const p of voices.release(pitch)) calls.push(`off ${p}`);
    },
  };
}

describe("건반 미리듣기 음 켜고 끄기", () => {
  it("같은 건반을 누른 채 다른 악기로 다시 누르면 앞 음을 먼저 끈다 (PR122 점검)", () => {
    const e = fakeEngine();
    e.on("flute", 12);
    e.on("piano", 12);
    e.off(12);
    e.off(12);
    // 전에는 on 48 → on 36 → off 36 → off 12로 48이 꺼지지 않았다
    expect(e.calls).toEqual(["on 48", "off 48", "on 36", "off 36", "off 12"]);
  });

  it("다른 건반이 같은 높이로 접혀 울리는 중이면 끄지 않는다", () => {
    const e = fakeEngine();
    e.on("flute", 12);
    e.on("flute", 24);
    expect(e.calls).toEqual(["on 48", "on 48"]);
    e.off(12);
    expect(e.calls).toEqual(["on 48", "on 48"]);
    e.off(24);
    expect(e.calls).toEqual(["on 48", "on 48", "off 48"]);
  });

  it("다시 누를 때도 같은 높이로 울리는 다른 건반이 있으면 끄지 않는다", () => {
    const e = fakeEngine();
    e.on("flute", 12);
    e.on("flute", 24);
    e.on("piano", 12);
    expect(e.calls).toEqual(["on 48", "on 48", "on 36"]);
  });
});
