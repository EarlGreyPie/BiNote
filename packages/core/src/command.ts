import type { Song } from "./model.js";

/**
 * 모든 편집(타이핑, 마우스, MIDI 건반)은 명령 하나가 된다.
 * apply는 새 Song을 돌려주고(불변), invert는 되돌리는 명령을 만든다.
 */
export interface Command {
  readonly label: string;
  apply(song: Song): Song;
  invert(before: Song): Command;
}

interface Entry {
  readonly forward: Command;
  readonly backward: Command;
}

/** 실행 취소·다시 실행 스택. 텍스트와 피아노롤이 같은 스택을 쓴다. */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  /** 트랙 id → 음소거·솔로. 실행 취소로 사라졌다가 다시 실행으로 돌아온 트랙에도 얹는다 */
  private listening = new Map<string, { mute: boolean; solo: boolean }>();

  constructor(private current: Song) {}

  get song(): Song {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  run(command: Command): Song {
    const before = this.current;
    this.current = command.apply(before);
    // 새로 생긴 트랙은 같은 id를 쓰던 예전 트랙의 음소거·솔로를 물려받지 않는다
    const existed = new Set(before.tracks.map((t) => t.id));
    for (const t of this.current.tracks) if (!existed.has(t.id)) this.listening.set(t.id, { mute: t.mute, solo: t.solo });
    this.undoStack.push({ forward: command, backward: command.invert(before) });
    this.redoStack = [];
    return this.current;
  }

  /**
   * 기록을 남기지 않고 지금 곡을 바꾼다. 음소거·솔로처럼 듣는 방법만 바꾸고
   * 실행 취소 대상이 아닌 상태에 쓴다.
   */
  amend(next: Song): Song {
    for (const t of next.tracks) this.listening.set(t.id, { mute: t.mute, solo: t.solo });
    this.current = next;
    return this.current;
  }

  undo(): Song {
    const entry = this.undoStack.pop();
    if (!entry) return this.current;
    this.current = keepListening(this.current, entry.backward.apply(this.current), this.listening);
    this.redoStack.push(entry);
    return this.current;
  }

  redo(): Song {
    const entry = this.redoStack.pop();
    if (!entry) return this.current;
    this.current = keepListening(this.current, entry.forward.apply(this.current), this.listening);
    this.undoStack.push(entry);
    return this.current;
  }
}

/**
 * 음소거·솔로는 기록 밖 상태(amend)라서, 트랙째 되돌리는 명령이 옛 값으로 덮지 않게 지금 값을 다시 얹는다
 */
function keepListening(now: Song, next: Song, remembered: ReadonlyMap<string, { mute: boolean; solo: boolean }>): Song {
  const listening = new Map<string, { mute: boolean; solo: boolean }>(remembered);
  for (const t of now.tracks) listening.set(t.id, t);
  let changed = false;
  const tracks = next.tracks.map((t) => {
    const cur = listening.get(t.id);
    if (!cur || (cur.mute === t.mute && cur.solo === t.solo)) return t;
    changed = true;
    return { ...t, mute: cur.mute, solo: cur.solo };
  });
  return changed ? { ...next, tracks } : next;
}

/** 곡 전체를 바꿔 끼우는 가장 단순한 명령. 되돌릴 때는 이전 곡으로 바꾼다. */
export function replaceSong(label: string, next: Song): Command {
  return {
    label,
    apply: () => next,
    invert: (before) => replaceSong(label, before),
  };
}
