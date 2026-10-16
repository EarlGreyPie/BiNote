import { add, cmp, sub, type Rat } from "@mmlce/core";
import type { GridNote } from "./quantize.js";

/**
 * 2단계: 화음 수 압축 (설계 11장). 음이 새로 시작하는 자리마다 울리는 음(이어지는 음 + 새 음)이
 * 한도를 넘으면 남길 음을 고르고, 나머지 중 이어지던 음은 그 자리에서 끊고 새 음은 뺀다.
 *
 * 프리셋
 * - outer (기본, EarlGreyPie 방식): 오른손 맨위음·왼손 맨아래음부터 남기고 가운데를 뺀다.
 *   한도를 반씩 나눠 오른손은 위에서부터, 왼손은 아래에서부터 채운다(한쪽이 모자라면 남는 몫은 다른 쪽에).
 *   dropFirst로 어느 손의 화음음을 먼저 뺄지 고를 수 있다(맨위음·맨아래음은 어느 쪽이든 지킨다).
 * - top: 위에서부터 남긴다 / bottom: 아래에서부터 남긴다
 * - strong: 센 음부터 / long: 긴 음부터
 */
export type CompressPreset = "outer" | "top" | "bottom" | "strong" | "long";

export interface CompressOptions {
  readonly max: number;
  readonly preset?: CompressPreset;
  /** 이 파트의 음은 빼지 않는다 (멜로디 보호) */
  readonly protect?: ReadonlySet<string>;
  /** 오른손·왼손을 가르는 음 (이 음 이상이 오른손). 파트로 손을 알 수 있으면 hands가 우선 */
  readonly split?: number;
  /** outer에서 먼저 뺄 손의 화음음. both = 한도를 반씩 나눈다 (기본) */
  readonly dropFirst?: "both" | "right" | "left";
  /** 파트 → 손. 피아노 MIDI가 오른손·왼손 트랙으로 나뉜 경우 */
  readonly hands?: ReadonlyMap<string, "right" | "left">;
}

export interface CompressResult {
  readonly notes: GridNote[];
  /** 통째로 뺀 음 */
  readonly dropped: GridNote[];
  /** 끝을 자른 음 수 */
  readonly shortened: number;
  /** 빠진 소리: 뺀 음 전체와 자른 음의 남은 부분. 빈 채널 채우기의 후보 */
  readonly spare: GridNote[];
}

interface Live {
  note: GridNote;
  end: Rat;
  kept: boolean;
}

export function compressChords(input: readonly GridNote[], options: CompressOptions): CompressResult {
  const max = Math.max(1, options.max);
  const preset = options.preset ?? "outer";
  const split = options.split ?? 60;
  // 손을 파트로 모르면 그 자리 화음에서 가장 넓게 벌어진 음 사이를 손 경계로 본다
  // (MMLCS 27곡 검사: 위아래 성부 음높이 차가 대부분 10~22반음이라 경계가 잘 드러난다)
  let chordSplit = split;
  const handOf = (n: GridNote) => options.hands?.get(n.part) ?? (n.pitch >= chordSplit ? "right" : "left");
  const isProtected = (n: GridNote) => options.protect?.has(n.part) ?? false;

  const sorted = [...input].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch);
  const kept: Live[] = [];
  const dropped: GridNote[] = [];
  let sounding: Live[] = [];
  let shortened = 0;
  const tails: { note: GridNote; from: Rat }[] = [];

  for (let i = 0; i < sorted.length; ) {
    const at = sorted[i]!.start;
    const fresh: Live[] = [];
    while (i < sorted.length && cmp(sorted[i]!.start, at) === 0) {
      const note = sorted[i++]!;
      fresh.push({ note, end: add(note.start, note.dur), kept: true });
    }
    sounding = sounding.filter((l) => cmp(l.end, at) > 0);
    const all = [...sounding, ...fresh];
    if (all.length > max) {
      chordSplit = gapSplit(all.map((l) => l.note.pitch), split);
      const keep = choose(all, max, preset, handOf, isProtected, options.dropFirst ?? "both");
      for (const l of all) {
        if (keep.has(l)) continue;
        if (fresh.includes(l)) {
          l.kept = false;
          dropped.push(l.note);
        } else {
          // 이어지던 음은 여기서 끊는다
          tails.push({ note: l.note, from: at });
          l.end = at;
          shortened++;
        }
      }
      sounding = all.filter((l) => keep.has(l));
    } else sounding = all;
    for (const l of fresh) if (l.kept) kept.push(l);
  }

  return {
    notes: kept.map((l) => (cmp(l.end, add(l.note.start, l.note.dur)) === 0 ? l.note : { ...l.note, dur: sub(l.end, l.note.start) })),
    dropped,
    shortened,
    spare: [
      ...dropped,
      ...tails.map(({ note, from }) => ({ ...note, start: from, dur: sub(add(note.start, note.dur), from) })),
    ].sort((a, b) => cmp(a.start, b.start)),
  };
}

/** 음높이들에서 가장 넓은 틈(5반음 이상, 40~84 사이)의 가운데. 없으면 기본 경계 */
export function gapSplit(pitches: readonly number[], fallback: number): number {
  const sorted = [...pitches].sort((a, b) => a - b);
  let best = fallback;
  let widest = 4;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (lo < 40 || hi > 84) continue;
    if (hi - lo > widest) {
      widest = hi - lo;
      best = (lo + hi) / 2;
    }
  }
  return best;
}

function choose(
  all: readonly Live[],
  max: number,
  preset: CompressPreset,
  handOf: (n: GridNote) => "right" | "left",
  isProtected: (n: GridNote) => boolean,
  dropFirst: "both" | "right" | "left",
): Set<Live> {
  const keep = new Set<Live>();
  // 보호한 음 먼저 (넘치면 높은 음부터)
  for (const l of [...all].filter((l) => isProtected(l.note)).sort((a, b) => b.note.pitch - a.note.pitch)) {
    if (keep.size < max) keep.add(l);
  }
  // 같은 높이면 새로 치는 음(나중에 시작한 음)을 먼저 남긴다
  const newerFirst = (a: Live, b: Live) => cmp(b.note.start, a.note.start);
  const rest = all.filter((l) => !keep.has(l));
  const fill = (order: Live[]) => {
    for (const l of order) if (keep.size < max) keep.add(l);
  };
  switch (preset) {
    case "top":
      fill(rest.sort((a, b) => b.note.pitch - a.note.pitch || newerFirst(a, b)));
      break;
    case "bottom":
      fill(rest.sort((a, b) => a.note.pitch - b.note.pitch || newerFirst(a, b)));
      break;
    case "strong":
      fill(rest.sort((a, b) => b.note.velocity - a.note.velocity || b.note.pitch - a.note.pitch));
      break;
    case "long":
      fill(rest.sort((a, b) => cmp(b.end, a.end) || b.note.pitch - a.note.pitch));
      break;
    case "outer": {
      const right = rest.filter((l) => handOf(l.note) === "right").sort((a, b) => b.note.pitch - a.note.pitch || newerFirst(a, b));
      const left = rest.filter((l) => handOf(l.note) === "left").sort((a, b) => a.note.pitch - b.note.pitch || newerFirst(a, b));
      if (dropFirst === "both") {
        const room = max - keep.size;
        let rightRoom = Math.min(right.length, Math.ceil(room / 2));
        const leftRoom = Math.min(left.length, room - rightRoom);
        rightRoom = Math.min(right.length, room - leftRoom);
        // 오른손은 위에서부터, 왼손은 아래에서부터: 맨위음과 맨아래음이 먼저 남고 가운데가 빠진다
        fill(right.slice(0, rightRoom));
        fill(left.slice(0, leftRoom));
      } else {
        // 맨위음·맨아래음을 먼저 남기고, 남는 자리는 버리지 않는 손부터 채운다
        fill(right.slice(0, 1));
        fill(left.slice(0, 1));
        const [first, second] = dropFirst === "right" ? [left, right] : [right, left];
        fill(first.slice(1));
        fill(second.slice(1));
      }
      break;
    }
  }
  return keep;
}
