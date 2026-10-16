import { add, cmp, normalizeTempo, sub, ZERO, type Rat, type Song, type TempoEvent, type TrackText } from "@mmlce/core";
import { parseMml, type ParseResult } from "./parser.js";

/**
 * 원문 속 템포(t) 다루기. 곡 템포 지도(Song.tempo)가 진짜 값이고, 원문의 t는 쓴 사람의 표기를 지키는 거울이다.
 * 지도를 고칠 때 원문의 t도 같이 고쳐(수술) 둘이 어긋나지 않게 한다.
 */

/** 원문의 t 하나: 곡 위치(원문 offset을 더한 값), 빠르기, 글 범위 */
export interface TempoToken {
  readonly at: Rat;
  readonly bpm: number;
  readonly span: readonly [number, number];
}

export function tempoTokens(source: TrackText, parsed: ParseResult = parseMml(source.text)): TempoToken[] {
  // 파서는 t를 읽을 때 템포와 값(kind "tempo")을 같은 순서로 하나씩 넣는다
  const spans = parsed.values.filter((v) => v.kind === "tempo");
  return parsed.tempo.map((e, k) => ({ at: source.offset ? add(e.at, source.offset) : e.at, bpm: e.bpm, span: spans[k]!.span }));
}

/**
 * 원문 위치 at(원문 안 위치, offset을 뺀 값)에 t를 끼울 글 자리. 그 위치에서 시작하는 음·쉼표 바로 앞,
 * 또는 원문 끝 위치면 글 끝. 음 가운데라 끼울 자리가 없으면 undefined.
 * &로 이어진 음 앞은 & 뒤(`c4&t90d4`)가 되므로, 같은 자리에 다른 후보가 없을 때만 쓴다.
 */
export function tempoInsertOffset(text: string, parsed: ParseResult, at: Rat): number | undefined {
  const elements = [
    ...parsed.notes.map((n) => ({ start: n.start, end: add(n.start, n.dur), span: n.span, tied: n.tie === "next" })),
    ...parsed.rests.map((r) => ({ start: r.start, end: add(r.start, r.dur), span: r.span, tied: false })),
  ].sort((a, b) => a.span[0] - b.span[0]);
  let afterTie: number | undefined;
  for (let k = 0; k < elements.length; k++) {
    const e = elements[k]!;
    if (cmp(e.start, at) !== 0) continue;
    const prev = elements[k - 1];
    if (prev?.tied && cmp(prev.end, at) === 0) afterTie ??= e.span[0];
    else return e.span[0];
  }
  if (afterTie !== undefined) return afterTie;
  if (cmp(parsed.end, at) === 0) return text.length;
  return undefined;
}

/** 글 범위들을 새 글로 바꾼다 (겹치지 않는 범위, 순서 무관) */
export function spliceText(text: string, edits: readonly { readonly span: readonly [number, number]; readonly text: string }[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.span[0] - a.span[0])) out = out.slice(0, e.span[0]) + e.text + out.slice(e.span[1]);
  return out;
}

/** 원문 하나를 수술할 수 있는지 (문법 오류가 있으면 손대지 않는다) */
export function surgicalSource(source: TrackText): { parsed: ParseResult; tokens: TempoToken[] } | undefined {
  const parsed = parseMml(source.text);
  if (parsed.diagnostics.some((d) => d.level === "error")) return undefined;
  return { parsed, tokens: tempoTokens(source, parsed) };
}

/** 원문 안 위치로 (offset 앞이면 undefined) */
export function localAt(source: TrackText, at: Rat): Rat | undefined {
  if (!source.offset) return at;
  const local = sub(at, source.offset);
  return cmp(local, ZERO) < 0 ? undefined : local;
}

export function sameTempo(a: readonly TempoEvent[], b: readonly TempoEvent[]): boolean {
  return a.length === b.length && a.every((e, i) => e.bpm === b[i]!.bpm && cmp(e.at, b[i]!.at) === 0);
}

/**
 * 들리는 템포만: 앞 템포와 빠르기가 같은 템포(바뀌는 게 없는 t)는 뺀다. 첫 템포는 둔다.
 * 악보마다 템포를 넣을 때 음을 쪼갤 수 없는 자리의 t는 뒤쪽 음 경계로 옮겨 적으므로, 여러 악보의 t를 모으면
 * 같은 빠르기가 조금 늦은 자리에 한 번 더 나온다. 그런 t는 소리를 바꾸지 않는다
 */
export function audibleTempo(events: readonly TempoEvent[]): TempoEvent[] {
  const out: TempoEvent[] = [];
  for (const e of normalizeTempo(events)) if (out.length === 0 || out[out.length - 1]!.bpm !== e.bpm) out.push(e);
  return out;
}

/** 템포 지도에서 at 자리에 걸린 빠르기 (at보다 앞이거나 같은 자리의 마지막 템포). 없으면 undefined */
export function tempoAtPosition(map: readonly TempoEvent[], at: Rat): number | undefined {
  let bpm: number | undefined;
  for (const e of normalizeTempo(map)) if (cmp(e.at, at) <= 0) bpm = e.bpm;
  return bpm;
}

/**
 * 원문들의 t와 곡 템포 지도가 어긋났는지. 원문에 적힌 t는 늘 지도와 맞아야 한다(그 자리 지도 템포와 같은 빠르기).
 * 모든 트랙에 원문이 있으면(3MLE에 원문 그대로 저장하는 경우) 들리는 템포가 같아야 한다.
 * 원문 없는 트랙이 있으면 저장 때 어차피 출력기가 지도대로 다시 쓰므로 지도에만 있는 템포는 괜찮다
 */
export function tempoMismatch(song: Song): boolean {
  const declared = normalizeTempo(song.tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml).map(({ at, bpm }) => ({ at, bpm })) : [])));
  const map = normalizeTempo(song.tempo);
  if (song.tracks.length === 0) return false;
  if (song.tracks.some((t) => !t.mml)) return !declared.every((d) => tempoAtPosition(map, d.at) === d.bpm);
  return !sameTempo(audibleTempo(declared), audibleTempo(map));
}
