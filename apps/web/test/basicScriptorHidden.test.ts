import { describe, expect, it } from "vitest";
import { LOCALES, translate } from "@mmlce/i18n";
import { BASIC_SCRIPTOR_ON } from "../src/lib/basicScriptor";

/** Basic Scriptor 프로그램이 나오기 전(rc 전)에는 받아 적기에서 Basic Scriptor를 숨긴다. 켜는 날 이 시험도 함께 고친다 */
describe("Basic Scriptor 숨기기", () => {
  it("꺼 둔 상태다", () => {
    expect(BASIC_SCRIPTOR_ON).toBe(false);
  });

  it("숨겼을 때 보이는 문구는 어느 언어에도 Basic Scriptor·MuScriptor를 말하지 않는다", () => {
    const keys = ["ui.labTranscribeHelp", "ui.transcribeSongTempoHelp", "ui.transcribeRights", "ui.transcribeTooLong"] as const;
    for (const locale of LOCALES) {
      for (const key of keys) {
        const text = translate(locale, key, { minutes: 10 });
        expect(text, `${locale} ${key}`).not.toMatch(/Basic Scriptor|MuScriptor/);
      }
    }
  });
});
