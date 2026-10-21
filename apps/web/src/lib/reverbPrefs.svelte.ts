import { MOBILE_PROFILE, rat, REVERB_LEVELS_MAX, type Rat, type ReverbBatch, type ReverbTail } from "@mmlce/core";
import { loadStored, parseJson, saveStored } from "./persist";
import { parseReverbChoice, REVERB_CHOICE_KEY, type ReverbChoice } from "./labOptions";

/** 실험실 울림 설정: 울림 넣기 창에서 바꾸고, 피아노롤 울림 찍기 도구와 타브 커서 찍기가 같은 값을 쓴다 (이 브라우저에 기억) */
export const reverbPrefs = $state<{ choice: ReverbChoice }>({
  choice: loadStored(REVERB_CHOICE_KEY, (raw) => parseReverbChoice(parseJson(raw), MOBILE_PROFILE.volume.max, REVERB_LEVELS_MAX)),
});

export function setReverbChoice(change: Partial<ReverbChoice>): void {
  reverbPrefs.choice = { ...reverbPrefs.choice, ...change };
  saveStored(REVERB_CHOICE_KEY, JSON.stringify(reverbPrefs.choice));
}

/** 찍기에 쓰는 꼬리 설정 */
export function stampTail(c: ReverbChoice): ReverbTail & { readonly keep: Rat } {
  return { levels: c.levels, piece: rat(1, c.piece), keep: rat(1, c.keep) };
}

/** 일괄 넣기 설정 */
export function batchOptions(c: ReverbChoice): ReverbBatch {
  return {
    ...stampTail(c),
    minLength: rat(1, c.minLength),
    beforeRest: c.beforeRest,
    fillMaxNote: rat(1, c.fillMaxNote),
    ...(c.fill ? { fillLevel: c.fillLevel } : {}),
  };
}
