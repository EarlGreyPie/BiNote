import { add, cmp, type Rat } from "./rat.js";
import type { Note, Track } from "./model.js";

export function noteEnd(note: Note): Rat {
  return add(note.start, note.dur);
}

export interface OverlapIssue {
  readonly trackId: string;
  readonly first: string;
  readonly second: string;
}

/** 한 트랙 안에서 겹치는 음을 찾는다. 화음별 트랙 원칙상 겹치면 안 된다. */
export function findOverlaps(track: Track): OverlapIssue[] {
  const sorted = [...track.notes].sort((a, b) => cmp(a.start, b.start));
  const issues: OverlapIssue[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cmp(noteEnd(prev), cur.start) > 0) {
      issues.push({ trackId: track.id, first: prev.id, second: cur.id });
    }
  }
  return issues;
}

/** 위치 `at`에서 소리 나는 음 (끝 위치는 포함하지 않음). */
export function soundingAt(track: Track, at: Rat): Note | undefined {
  return track.notes.find((n) => cmp(n.start, at) <= 0 && cmp(at, noteEnd(n)) < 0);
}
