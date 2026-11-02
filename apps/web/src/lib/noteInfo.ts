import { barBeatAt, fromLength, placeLoss, rat, type Note, type PlaceLoss, type Rat, type TimeSigEvent } from "@mmlce/core";

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/** MML 이름 (o4c = 60) */
export function pitchText(pitch: number): string {
  return `o${Math.floor(pitch / 12) - 1}${NAMES[((pitch % 12) + 12) % 12]}`;
}

/** 분수 그대로 (정수면 정수만) */
export function ratText(r: Rat): string {
  return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`;
}

/**
 * 음 길이를 MML 길이로 (1/8 → "8", 3/16 → "8.", 7/32 → "8.."). 점 두 개까지로 못 쓰면 분수 그대로.
 * 64보다 짧은 길이도 분수로 쓴다 (게임 길이 1~64)
 */
export function lengthText(dur: Rat): string {
  for (let dots = 0; dots <= 2; dots++) {
    const scale = 2 ** dots;
    // dur = (2·2^dots − 1) / (len · 2^dots) → len = (2·2^dots − 1) · d / (n · 2^dots)
    const top = (2 * scale - 1) * dur.d;
    const bottom = dur.n * scale;
    if (top % bottom === 0) {
      const len = top / bottom;
      if (len >= 1 && len <= 64) return `${len}${".".repeat(dots)}`;
    }
  }
  return ratText(dur);
}

/** "8", "8.", "l16..", "1/7", "3/16"을 길이(온음표 단위)로. 못 읽으면 undefined */
export function parseLength(text: string): Rat | undefined {
  const s = text.trim().replace(/^l/i, "");
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) {
    const n = Number(frac[1]);
    const d = Number(frac[2]);
    return n > 0 && d > 0 && Number.isSafeInteger(n) && Number.isSafeInteger(d) ? rat(n, d) : undefined;
  }
  const len = /^(\d+)(\.*)$/.exec(s);
  if (!len) return undefined;
  const n = Number(len[1]);
  if (n < 1 || n > 9999) return undefined;
  return fromLength(n, len[2]!.length);
}

/** 마디:박 (박 사이면 소수) */
export function positionText(timeSig: readonly TimeSigEvent[], at: Rat): string {
  const { bar, beat } = barBeatAt(timeSig, at);
  return `${bar}:${beat}`;
}

/** 고른 음들에서 모두 같은 값이면 그 값, 다르면 null */
export function common<T>(notes: readonly Note[], pick: (n: Note) => T, same: (a: T, b: T) => boolean = (a, b) => a === b): T | null {
  if (notes.length === 0) return null;
  const first = pick(notes[0]!);
  return notes.every((n) => same(pick(n), first)) ? first : null;
}

/**
 * 고른 음(ids) 길이를 모두 dur로 바꾸면 고르지 않은 다른 음 가운데 무엇이 잘리고 지워지는지 (트랙마다 placeLoss를 모은다).
 * 정보 칸에서 길이를 넣기 전에 물어볼지 정할 때 쓴다. 규칙은 바꿀 때 쓰는 replaceNotes와 같다
 */
export function lengthLoss(tracks: readonly { readonly notes: readonly Note[] }[], ids: ReadonlySet<string>, dur: Rat): PlaceLoss {
  const cut = new Map<string, Rat>();
  const removed = new Set<string>();
  for (const track of tracks) {
    const changes = new Map<string, Note | null>();
    for (const n of track.notes) if (ids.has(n.id)) changes.set(n.id, { ...n, dur });
    if (changes.size === 0) continue;
    const loss = placeLoss(track.notes, changes);
    for (const [id, left] of loss.cut) cut.set(id, left);
    for (const id of loss.removed) removed.add(id);
  }
  return { cut, removed };
}
