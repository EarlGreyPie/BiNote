import { add, cmp, getProfile, normalizeTempo, PROFILES, sub, ZERO, type GameProfile, type Rat, type Song, type TempoEvent, type TrackText } from "@mmlce/core";
import { sameSound } from "./compare.js";
import { parseMml, type ParseResult } from "./parser.js";
import type { PrintableNote } from "./printer.js";
import { chordsPerScore } from "./clipboard.js";
import { scoreEnd, tempoBefore } from "./score-end.js";
import { scoreTrackIds } from "./tempo-placement.js";

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

/** 주석(닫히지 않은 주석은 끝까지)·빈칸·줄바꿈을 벗기고 작은 글자로 (파서가 건너뛰는 것과 같은 규칙) */
function withoutBlanks(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 2;
      continue;
    }
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") out += ch;
    i++;
  }
  return out.toLowerCase();
}

/**
 * 원문을 게임에 넣을 글로 줄인다: 원문의 t를 모두 지우고 tempo(곡 위치)를 그 자리 음·쉼표 앞에 다시 적은 뒤,
 * 주석·빈칸·줄바꿈을 벗긴다. 사용자가 쓴 표기는 그대로라 출력기 글보다 짧을 때가 있다.
 * 원문에 offset이 있거나, 경고·오류가 있거나, 프로필 범위 밖 값(길이·점·옥타브·볼륨)이 있거나,
 * 템포를 끼울 음 경계가 없으면 undefined. 소리가 같은지는 고르는 쪽(shortestWriting)이 다시 읽어 본다
 */
export function gameSource(source: TrackText, tempo: readonly TempoEvent[], profile: GameProfile): string | undefined {
  if (source.offset && cmp(source.offset, ZERO) !== 0) return undefined;
  const parsed = parseMml(source.text);
  if (parsed.diagnostics.length > 0) return undefined;
  const inRange = parsed.values.every((v) => {
    if (v.kind === "tempo") return true;
    const range =
      v.kind === "length" ? profile.length : v.kind === "dots" ? { min: 0, max: profile.length.dots } : v.kind === "octave" ? profile.octave : profile.volume;
    return v.value >= range.min && v.value <= range.max;
  });
  if (!inRange) return undefined;
  // 같은 글 자리에 끼울 t는 한 글로 묶는다 (따로 끼우면 순서가 뒤집힌다)
  const inserts = new Map<number, string>();
  for (const e of normalizeTempo(tempo)) {
    const at = tempoInsertOffset(source.text, parsed, e.at);
    if (at === undefined) return undefined;
    inserts.set(at, (inserts.get(at) ?? "") + `t${e.bpm}`);
  }
  const edits = [
    ...tempoTokens(source, parsed).map((t) => ({ span: t.span, text: "" })),
    ...[...inserts].map(([at, text]) => ({ span: [at, at] as const, text })),
  ];
  return withoutBlanks(spliceText(source.text, edits));
}

/**
 * 후보 글 가운데 다시 읽은 음이 notes와 같고 들리는 템포가 tempo와 같은 가장 짧은 글 (길이가 같으면 앞 후보).
 * 맞는 글이 없으면 undefined. 게임 출력·글자 수 줄이기가 원문보다 길게 쓰지 않으려고 쓴다
 */
export function shortestWriting(notes: readonly PrintableNote[], tempo: readonly TempoEvent[], candidates: readonly (string | undefined)[]): string | undefined {
  const expected = audibleTempo(tempo);
  let best: string | undefined;
  for (const text of candidates) {
    if (text === undefined || (best !== undefined && text.length >= best.length)) continue;
    const parsed = parseMml(text);
    if (sameSound(parsed.notes, notes) && sameTempo(audibleTempo(parsed.tempo), expected)) best = text;
  }
  return best;
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
 * 원문 없는 트랙이 있으면 저장 때 어차피 출력기가 지도대로 다시 쓰므로 지도에만 있는 템포는 괜찮다.
 * 악보 끝(그 악보의 게임 길이) 자리와 그 뒤 템포는 소리에 영향이 없으므로 보지 않는다. 원문 t는 악보마다 그 악보 끝까지,
 * 지도는 가장 긴 악보 끝까지 본다 (글자 수 줄이기의 검사와 같은 규칙: tempoBefore·scoreEnd).
 * 그래서 길이를 지키려고 끝에 붙인 그 자리 빠르기 t는 어긋남이 아니다
 */
export function tempoMismatch(song: Song): boolean {
  if (song.tracks.length === 0) return false;
  const chords = chordsPerScore(song, PROFILES[song.meta.profileId] ?? getProfile("mobile"));
  const scores = scoreTrackIds(song, chords).map((ids) => song.tracks.filter((t) => ids.includes(t.id)));
  const declared = normalizeTempo(
    scores.flatMap((tracks) =>
      tempoBefore(
        tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml).map(({ at, bpm }) => ({ at, bpm })) : [])),
        scoreEnd(tracks),
      ),
    ),
  );
  const map = normalizeTempo(tempoBefore(song.tempo, scoreEnd(song.tracks)));
  if (song.tracks.some((t) => !t.mml)) return !declared.every((d) => tempoAtPosition(map, d.at) === d.bpm);
  return !sameTempo(audibleTempo(declared), audibleTempo(map));
}
