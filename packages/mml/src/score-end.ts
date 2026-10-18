import { add, cmp, DEFAULT_BPM, normalizeTempo, sub, ZERO, type Rat, type TempoEvent, type Track, type TrackText } from "@mmlce/core";
import { parseMml, type ParseResult } from "./parser.js";
import { restText } from "./printer.js";

/**
 * 악보 길이 지키기. 게임은 채널마다 맨 끝 쉼표 하나만 길이에서 빼고, 악보 길이는 가장 긴 채널로 정한다(실측).
 * 사용자가 쓴 원문 끝의 쉼표는 뒤에 명령이 하나 더 있으면(`r1t120`) 길이에 들어가지만, 음 목록에는 쉼표가 없어서
 * 출력기로 다시 쓰면 사라진다. 그래서 원문이 있는 트랙은 원문의 게임 길이를 악보 길이로 보고,
 * 다시 쓴 글에도 그 길이를 지킨다 (모자라면 쉼표와 템포 한 개를 덧붙인다: padScore).
 * 악보 길이보다 뒤에 있는 곡 템포는 그 악보에 쓰지 않는다 (그 악보는 이미 끝났다).
 * 원문 없는 트랙은 끝 쉼표를 알 수 없으므로 마지막 음 끝이 길이다.
 */

/** 원문의 게임 길이 (맨 끝 쉼표는 게임이 길이에서 뺀다), 곡 위치로 */
export function textEnd(mml: TrackText, parsed: ParseResult = parseMml(mml.text)): Rat {
  return mml.offset ? add(mml.offset, parsed.gameEnd) : parsed.gameEnd;
}

/** 트랙 길이: 원문이 있으면 원문의 게임 길이, 없으면 마지막 음 끝 */
export function trackEnd(track: Track): Rat {
  if (track.mml) return textEnd(track.mml);
  let end: Rat = ZERO;
  for (const n of track.notes) {
    const e = add(n.start, n.dur);
    if (cmp(e, end) > 0) end = e;
  }
  return end;
}

/** 악보 길이: 가장 긴 트랙 길이. ends를 주면 그 트랙은 그 길이로 본다 (음을 옮기기 전 길이 등) */
export function scoreEnd(tracks: readonly Track[], ends?: ReadonlyMap<string, Rat>): Rat {
  let end: Rat = ZERO;
  for (const t of tracks) {
    const e = ends?.get(t.id) ?? trackEnd(t);
    if (cmp(e, end) > 0) end = e;
  }
  return end;
}

/** 악보 길이 앞의 템포만 (그 악보가 끝난 뒤 템포는 쓰지 않는다) */
export function tempoBefore(tempo: readonly TempoEvent[], end: Rat): TempoEvent[] {
  return tempo.filter((e) => cmp(e.at, end) < 0);
}

/** at 바로 앞까지 울리는 빠르기 (at에 있는 템포는 넣지 않는다) */
export function bpmBefore(tempo: readonly TempoEvent[], at: Rat): number {
  let bpm = DEFAULT_BPM;
  for (const e of normalizeTempo(tempo)) if (cmp(e.at, at) < 0) bpm = e.bpm;
  return bpm;
}

/**
 * 한 악보의 글들이 게임 길이 end(글 위치)까지 가게 한다. 이미 어느 글이 end까지 가면 그대로 둔다.
 * 아니면 가장 멀리 가는 글 끝에 모자란 쉼표와 템포 하나(bpm, 그 자리 빠르기라 소리는 그대로)를 붙인다:
 * 쉼표 뒤에 명령이 있으면 게임이 그 쉼표를 길이에 넣는다. 맨 끝 쉼표가 이미 end를 넘으면 붙이지 않는다
 */
export function padScore(texts: readonly string[], end: Rat, bpm: number, editable?: readonly boolean[]): string[] {
  if (cmp(end, ZERO) <= 0 || texts.length === 0) return [...texts];
  const parsed = texts.map((t) => parseMml(t));
  if (parsed.some((p) => cmp(p.gameEnd, end) >= 0)) return [...texts];
  // 고칠 수 있는 글(잠근 트랙은 빼고) 가운데 맨 끝 쉼표까지 end를 넘지 않고 가장 멀리 가는 글
  let pick = -1;
  parsed.forEach((p, k) => {
    if (editable && !editable[k]) return;
    if (cmp(p.end, end) <= 0 && (pick < 0 || cmp(p.end, parsed[pick]!.end) > 0)) pick = k;
  });
  if (pick < 0) return [...texts];
  const fill = sub(end, parsed[pick]!.end);
  const out = [...texts];
  out[pick] = texts[pick]! + (fill.n > 0 ? restText(fill) : "") + `t${bpm}`;
  return out;
}
