import { LOCALES } from "@mmlce/i18n";
import type { InstrumentInfo } from "@mmlce/core";
import type { InstrumentName, MmlAtBlock } from "@mmlce/fileio";
import { instrumentNameIn } from "./instrumentLabel";

/**
 * MML@ 글 머리줄에서 찾을 악기 이름: 고를 수 있는 악기마다 5개 언어 화면 이름과 공통 ID(piano 등).
 * 글은 다른 언어 사용자가 썼을 수도 있으므로 지금 화면 언어만 보지 않는다
 */
export function pasteInstrumentNames(choices: readonly InstrumentInfo[]): InstrumentName[] {
  const out: InstrumentName[] = [];
  for (const info of choices) {
    if (info.program === undefined) continue;
    const instrument = { canonical: info.id, program: info.program };
    const names = new Set([info.id, info.id.replace(/-/g, " "), ...LOCALES.map((l) => instrumentNameIn(l, info.id))]);
    for (const name of names) out.push({ name, instrument });
  }
  return out;
}

/** 지금 트랙을 덮어쓸 때 고를 수 있는 글: 글 안 모든 악보의 트랙 하나하나 (글 순서) */
export interface ReplaceSource {
  /** 악보 차례 (1부터) */
  readonly score: number;
  /** 그 악보 안 트랙 차례 (1부터) */
  readonly track: number;
  readonly text: string;
}

export function replaceSources(blocks: readonly MmlAtBlock[]): ReplaceSource[] {
  return blocks.flatMap((b, k) => b.parts.map((text, i) => ({ score: k + 1, track: i + 1, text })));
}
