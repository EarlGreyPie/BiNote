import { describe, expect, it } from "vitest";
import { LOCALES, translate } from "@mmlce/i18n";
import { BASIC_SCRIPTOR_ON } from "../src/lib/basicScriptor";

/** 1.1 개발 브랜치에서는 Basic Scriptor를 켜 둔다(1.0 판 main은 꺼 둠). 다시 숨겨야 하면 false로 바꾸고 이 시험도 함께 고친다 */
describe("Basic Scriptor 켜기·숨기기", () => {
  it("켠 상태다", () => {
    expect(BASIC_SCRIPTOR_ON).toBe(true);
  });

  it("켰을 때 쓰는 문구는 어느 언어에도 Basic Scriptor를 말한다", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "ui.labTranscribeHelpScriptor"), locale).toMatch(/Basic Scriptor/);
    }
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
