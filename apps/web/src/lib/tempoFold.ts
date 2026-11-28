import { barBeatAt, tempoClock, type Rat, type Song } from "@mmlce/core";
import { foldTempoRangeResult, setTempos, tempoFoldScale, type TempoFoldResult } from "@mmlce/mml";
import type { MessageKey, Params } from "@mmlce/i18n";
import { scaleText, tempoConvertFailedText } from "./tempoConvert";
import type { TempoPlan } from "./tempoSync";

/**
 * 1.1 설계 4번 (실험실): 범위 밖 템포를 넣는 자리에서 바로 음 길이로 풀기.
 * 탭 템포·마디선 끌기·템포 창·음 시작 맞추기가 게임 템포 범위 밖 값을 낼 때, 그 템포 조각의 음 길이·박자표를 2배(또는 반)로 바꾸고
 * 범위 안 템포를 넣는다 (foldTempoRangeResult). 들리는 시각은 그대로다. 못 풀면 부르는 쪽이 지금처럼 넣고 알린다
 */

type Range = { readonly min: number; readonly max: number };
type Translate = (key: MessageKey, params?: Params) => string;

/** 템포 하나가 게임 범위 밖인지 */
export const outOfRange = (bpm: number, range: Range): boolean => bpm < range.min || bpm > range.max;

/** 계획에 범위 밖 템포가 있는지 (끝값으로 막기 전 값) */
export function planOutOfRange(plan: TempoPlan, range: Range): boolean {
  return plan.set.some((e) => outOfRange(e.bpm, range));
}

/** 계획(끝값으로 막지 않은 값)을 넣은 곡에서 그 계획이 넣은 범위 밖 템포를 길이로 푼다. 바꾸기 전 자리는 song 기준 */
export function foldPlan(song: Song, plan: TempoPlan, range: Range): TempoFoldResult {
  const raw = setTempos(plan.set, plan.remove).apply(song);
  const only = plan.set.filter((e) => outOfRange(e.bpm, range)).map((e) => e.at);
  return foldTempoRangeResult(raw, range, only);
}

/** 자리를 마디:박으로 */
function where(song: Song, at: Rat): string {
  const { bar, beat } = barBeatAt(song.timeSig, at);
  return `${bar}:${Number.isInteger(beat) ? beat : Number(beat.toFixed(2))}`;
}

/** 푼 곳 하나를 글로 (2:1 t300 → t150, 길이 ×1/2) */
export function foldPlaceText(song: Song, f: TempoFoldResult["folded"][number], t: Translate): string {
  return t("ui.tempoFoldPlace", { where: where(song, f.at), bpm: f.bpm, to: f.to, scale: scaleText(f.scale) });
}

/** 길이로 푼 결과 한 줄 (몇 곳 · 앞 몇 곳 · 반올림한 템포). song은 바꾸기 전 곡 */
export function foldDoneText(song: Song, result: TempoFoldResult, t: Translate): string {
  const places = result.folded.slice(0, 3).map((f) => foldPlaceText(song, f, t));
  if (result.folded.length > 3) places.push(t("ui.outputTempoConvertMore", { count: result.folded.length - 3 }));
  const rounded = result.rounded.map((r) => t("ui.tempoFoldRounded", { bpm: r.bpm, to: r.to }));
  // 정수 템포로 적어 생긴 시각 차이 (올림·내림을 골라 쌓이지 않게 한 뒤 남은 양)
  const shift = result.rounded.length > 0 ? [t("ui.tempoFoldShift", { ms: Number((result.shift * 1000).toFixed(1)) })] : [];
  return [t("ui.tempoFoldDone", { n: result.folded.length, places: places.join(", ") }), ...rounded, ...shift].join(" ");
}

/** 못 푼 까닭 한 줄. 4배로도 범위에 안 드는 템포는 그것만 따로 적는다. song은 바꾸기 전 곡 */
export function foldFailedText(song: Song, result: TempoFoldResult, range: Range, maxLength: number, t: Translate): string {
  const far = result.failed.find((f) => f.kind === "tempo" && outOfRange(f.bpm, range) && !tempoFoldScale(f.bpm, range));
  if (far && far.kind === "tempo") return t("ui.tempoFoldTooFar", { where: where(song, far.at), bpm: far.bpm, min: range.min, max: range.max });
  return tempoConvertFailedText(song, result.failed, maxLength, t);
}

/** 템포 창 미리보기: 이 템포를 길이로 풀면 쓸 배율과 템포. 범위 안이면 undefined, 4배로도 못 풀면 to 없음 */
export function foldOffer(bpm: number, range: Range): { readonly scale: string; readonly to: number } | { readonly scale?: undefined; readonly to?: undefined } | undefined {
  if (!outOfRange(bpm, range)) return undefined;
  const scale = tempoFoldScale(bpm, range);
  return scale ? { scale: scaleText(scale), to: Math.round((bpm * scale.n) / scale.d) } : {};
}

/** 바꾸기 전 곡의 음 시작이 바꾼 뒤 곡에서 가장 많이 움직인 양 (초). 자리는 move로 옮겨 견준다 */
export function maxShiftMoved(before: Song, after: Song, move: (at: Rat) => Rat): number {
  const a = tempoClock(before.tempo);
  const b = tempoClock(after.tempo);
  let most = 0;
  for (const tr of before.tracks) for (const n of tr.notes) most = Math.max(most, Math.abs(b(move(n.start)) - a(n.start)));
  return most;
}
