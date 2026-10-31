import { barBeatAt, cmp, normalizeTempo, rat, type Rat, type Song } from "@mmlce/core";
import { parseMml, type TempoConvertFailure, type TempoConvertResult } from "@mmlce/mml";
import type { MessageKey, Params } from "@mmlce/i18n";
import type { TempoAdvice } from "./output";

/**
 * 출력 패널의 범위 밖 템포 안내 한 줄을 '실제 시간 유지 템포 변환'(convertTempoResult)으로 고칠 구간과 배율.
 * 구간은 그 템포 자리부터 다음 템포 앞까지(뒤에 템포가 없으면 곡 끝까지)라서 다른 템포 구간은 건드리지 않는다
 */
export interface TempoConvertPlan {
  readonly from: Rat;
  /** 구간 끝 (없으면 곡 끝까지) */
  readonly to: Rat | undefined;
  /** 음 길이·템포에 곱할 배율. 빠를 때 1/factor, 느릴 때 factor */
  readonly scale: Rat;
}

/**
 * 안내 한 줄을 고칠 구간과 배율. 바꾼 템포(advice.to)도 게임 범위 밖이면(느린 쪽은 배율 64에서 멈춘다) 고칠 수 없으니 undefined
 */
export function tempoConvertPlan(song: Song, advice: TempoAdvice, range: { readonly min: number; readonly max: number }): TempoConvertPlan | undefined {
  if (advice.to < range.min || advice.to > range.max || advice.factor <= 1) return undefined;
  const next = normalizeTempo(song.tempo).find((e) => cmp(e.at, advice.at) > 0);
  return { from: advice.at, to: next?.at, scale: advice.high ? rat(1, advice.factor) : rat(advice.factor) };
}

/** 배율을 사람이 읽는 글로 (1/2, 2) */
export function scaleText(scale: Rat): string {
  return scale.d === 1 ? String(scale.n) : `${scale.n}/${scale.d}`;
}

/** 단추를 누른 결과. App이 곡을 바꾸거나(done) 거절한 까닭을 돌려준다. 잠근 트랙 확인에서 그만두면 결과가 없다 */
export type TempoConvertOutcome =
  /** 실행 취소 한 칸으로 곡을 바꿨다. song은 바꾼 뒤 곡 (실행 취소하면 알림을 지우려고 견준다) */
  | { readonly kind: "done"; readonly song: Song; readonly result: TempoConvertResult }
  /** 정확히 쓸 수 없는 길이 등으로 곡을 그대로 두었다 */
  | { readonly kind: "failed"; readonly result: TempoConvertResult }
  /** 그 템포 뒤에 음이 없어 바꿀 것이 없다 */
  | { readonly kind: "nothing" }
  /** 편집 검사(쓸 수 없는 음 높이 등)나 계산 범위가 거절했다. message는 그 까닭 */
  | { readonly kind: "refused"; readonly message: string };

/** 거절 까닭을 몇 곳까지 보여 주나 (나머지는 "외 N곳") */
const SHOWN = 3;

type Translate = (key: MessageKey, params?: Params) => string;

/** 마디·박 (박이 정수가 아니면 소수 둘째 자리까지) */
function where(song: Song, at: Rat): { bar: number; beat: number } {
  const { bar, beat } = barBeatAt(song.timeSig, at);
  return { bar, beat: Number.isInteger(beat) ? beat : Number(beat.toFixed(2)) };
}

/** 거절 까닭 한 곳을 글로. song은 바꾸기 전 곡 (거절하면 곡이 그대로라 자리도 그 곡 기준이다) */
function failureText(song: Song, f: TempoConvertFailure, maxLength: number, t: Translate): string {
  const name = (id: string) => song.tracks.find((tr) => tr.id === id)?.name ?? id;
  switch (f.kind) {
    case "length":
      return t(f.rest ? "ui.outputTempoConvertLengthRest" : "ui.outputTempoConvertLength", {
        track: name(f.trackId),
        ...where(song, f.at),
        length: `${f.length.n}/${f.length.d}`,
        max: maxLength,
      });
    case "end":
      return t("ui.outputTempoConvertEnd", { track: name(f.trackId) });
    case "tempo":
      return t("ui.outputTempoConvertTempo", { ...where(song, f.at), bpm: f.bpm });
    case "meter":
      return t("ui.outputTempoConvertMeter", { bar: where(song, f.at).bar, beats: f.beats, unit: f.unit });
  }
}

/**
 * 거절 까닭을 한 줄로. 같은 트랙에서 같은 까닭으로 여러 곳이 걸리면 첫 곳만 적고, 앞 몇 곳 뒤는 "외 N곳"으로 센다
 */
export function tempoConvertFailedText(song: Song, failed: readonly TempoConvertFailure[], maxLength: number, t: Translate): string {
  const kindKey = (f: TempoConvertFailure) => (f.kind === "length" ? `length|${f.trackId}|${f.rest}` : f.kind === "end" ? `end|${f.trackId}` : `${f.kind}|${f.at.n}/${f.at.d}`);
  const seen = new Set<string>();
  const distinct = [...failed]
    .sort((a, b) => cmp(a.at, b.at))
    .filter((f) => {
      const key = kindKey(f);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const shown = distinct.slice(0, SHOWN);
  const reasons = shown.map((f) => failureText(song, f, maxLength, t));
  const more = failed.length - shown.length;
  if (more > 0) reasons.push(t("ui.outputTempoConvertMore", { count: more }));
  return t("ui.outputTempoConvertFailed", { reasons: reasons.join(" · ") });
}

/**
 * 단추를 누른 뒤 보여 줄 글. bad면 곡을 바꾸지 않았다. before는 누를 때의 곡, advice는 누른 안내 줄
 */
export function tempoConvertNotice(before: Song, advice: TempoAdvice, outcome: TempoConvertOutcome, maxLength: number, t: Translate): { readonly text: string; readonly bad: boolean } {
  switch (outcome.kind) {
    case "failed":
      return { text: tempoConvertFailedText(before, outcome.result.failed, maxLength, t), bad: true };
    case "nothing":
      return { text: t("ui.outputTempoConvertNothing"), bad: true };
    case "refused":
      return { text: outcome.message, bad: true };
    case "done": {
      const scale = scaleText(advice.high ? rat(1, advice.factor) : rat(advice.factor));
      const done = t("ui.outputTempoConvertDone", { bpm: advice.bpm, to: advice.to, scale });
      const rounded = outcome.result.rounded.map((r) => t("ui.outputTempoConvertRounded", { bpm: r.bpm, to: r.to, scale }));
      return { text: [done, ...rounded].join(" "), bad: false };
    }
  }
}

/**
 * 변환이 원문을 지우고 출력기로 다시 쓰는 트랙 중 원문에 문법 오류(t 뒤 숫자 없음 등)가 있는 트랙 이름.
 * 그런 원문은 화면 음과 게임이 읽는 소리가 다를 수 있어, 다시 쓰면 들리던 것이 바뀐다 (다른 템포 명령도 손대지 않는다)
 */
export function brokenRewrittenTracks(before: Song, after: Song): string[] {
  const now = new Map(after.tracks.map((tr) => [tr.id, tr]));
  return before.tracks
    .filter((tr) => tr.mml && now.get(tr.id)?.mml?.text !== tr.mml.text && parseMml(tr.mml.text).diagnostics.some((d) => d.level === "error"))
    .map((tr) => tr.name || tr.id);
}

/** 두 곡 사이에 바뀐 트랙 id (잠근 트랙이 끼었는지 물을 때 쓴다). 사라진 트랙도 넣는다 */
export function changedTrackIds(before: Song, after: Song): string[] {
  const now = new Map(after.tracks.map((tr) => [tr.id, tr]));
  return before.tracks.filter((tr) => now.get(tr.id) !== tr).map((tr) => tr.id);
}
