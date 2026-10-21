import type { PlayerTab, Song } from "./model.js";

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
  /** 이 단계를 실행 취소해 사라진 악보의 타브 튜닝. 다시 실행해 그 악보가 돌아오면 되살린다 */
  gone?: Map<string, PlayerTab | undefined>;
  /**
   * 이 단계가 직접 바꾼 악보 튜닝 (악보 id → 바꾸기 전·뒤). 튜닝은 보통 기록 밖이지만, 타브 숫자를 지키며 튜닝을 바꾸는
   * 단계처럼 음 높이와 튜닝을 함께 바꾼 단계는 실행 취소·다시 실행이 둘을 같이 되돌려야 타브가 어긋나지 않는다
   */
  tabs?: ReadonlyMap<string, { readonly before: PlayerTab | undefined; readonly after: PlayerTab | undefined }>;
}

/**
 * 곡을 바꾸는 명령을 기록에 넣기 전에 결과를 보는 검사. false면 곡을 그대로 두고 기록하지 않는다.
 * 모든 편집이 run 한 곳을 지나므로 검사도 여기 한 곳에 둔다 (편집하는 길마다 따로 붙이지 않는다)
 */
export type EditGuard = (before: Song, after: Song, command: Command) => boolean;

/** 실행 취소·다시 실행 스택. 텍스트와 피아노롤이 같은 스택을 쓴다. */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  /** 트랙 id → 음소거·솔로. 실행 취소로 사라졌다가 다시 실행으로 돌아온 트랙에도 얹는다 */
  private listening = new Map<string, { mute: boolean; solo: boolean }>();
  /**
   * 악보 id → 타브 튜닝(Player.tab). 튜닝은 보는 방법이라 기록 밖 상태(amend)다. 실행 취소·다시 실행이 곡째 되돌려도
   * 지금 튜닝을 다시 얹고, 사라졌다 돌아온 악보에도 마지막 튜닝을 얹는다
   */
  private tabs = new Map<string, PlayerTab | undefined>();

  /** 마지막 run을 검사가 거절했는지 */
  private wasRefused = false;

  constructor(
    private current: Song,
    private readonly guard?: EditGuard,
  ) {
    this.rememberTabs();
  }

  /** 지금 곡의 악보 튜닝을 기억한다. 새로 만든 악보(같은 id를 쓰던 지운 악보 포함)는 그 악보 것으로 바뀐다 */
  private rememberTabs(): void {
    for (const p of this.current.players) this.tabs.set(p.id, p.tab);
  }

  get song(): Song {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 마지막 run을 검사가 거절해 곡이 그대로인지 */
  get refused(): boolean {
    return this.wasRefused;
  }

  /**
   * 명령을 실행해 기록에 넣는다. 검사(guard)가 거절하면 곡도 기록도 그대로 두고 지금 곡을 돌려준다 (refused가 true).
   * unchecked: 검사를 일부러 건너뛰는 길 (MML 글 직접 입력처럼 쓴 글이 곧 출력인 편집)
   */
  run(command: Command, options?: { readonly unchecked?: boolean }): Song {
    const before = this.current;
    const after = command.apply(before);
    this.wasRefused = !options?.unchecked && after !== before && this.guard !== undefined && !this.guard(before, after, command);
    if (this.wasRefused) return before;
    this.current = after;
    // 새로 생긴 트랙은 같은 id를 쓰던 예전 트랙의 음소거·솔로를 물려받지 않는다
    const existed = new Set(before.tracks.map((t) => t.id));
    for (const t of this.current.tracks) if (!existed.has(t.id)) this.listening.set(t.id, { mute: t.mute, solo: t.solo });
    const tabs = changedTabs(before, after);
    this.undoStack.push({ forward: command, backward: command.invert(before), ...(tabs ? { tabs } : {}) });
    this.redoStack = [];
    this.rememberTabs();
    return this.current;
  }

  /**
   * 기록을 남기지 않고 지금 곡을 바꾼다. 음소거·솔로처럼 듣는 방법만 바꾸고
   * 실행 취소 대상이 아닌 상태에 쓴다.
   */
  amend(next: Song): Song {
    for (const t of next.tracks) this.listening.set(t.id, { mute: t.mute, solo: t.solo });
    this.current = next;
    this.rememberTabs();
    return this.current;
  }

  undo(): Song {
    const entry = this.undoStack.pop();
    if (!entry) return this.current;
    const next = keepListening(this.current, entry.backward.apply(this.current), this.listening);
    for (const [id, { before }] of entry.tabs ?? []) this.tabs.set(id, before);
    // 이 단계가 만든 악보는 실행 취소로 사라진다: 그 튜닝은 이 단계에 맡겨 두고, 같은 id의 옛 악보가 돌아오면 그 악보 것을 쓴다
    const live = new Set(next.players.map((p) => p.id));
    for (const p of this.current.players) {
      if (live.has(p.id)) continue;
      (entry.gone ??= new Map()).set(p.id, this.tabs.get(p.id));
      this.tabs.delete(p.id);
    }
    this.current = keepTabs(next, this.tabs);
    this.rememberTabs();
    this.redoStack.push(entry);
    return this.current;
  }

  redo(): Song {
    const entry = this.redoStack.pop();
    if (!entry) return this.current;
    for (const [id, tab] of entry.gone ?? []) this.tabs.set(id, tab);
    delete entry.gone;
    for (const [id, { after }] of entry.tabs ?? []) this.tabs.set(id, after);
    this.current = keepTabs(keepListening(this.current, entry.forward.apply(this.current), this.listening), this.tabs);
    this.rememberTabs();
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

/** 명령 하나가 바꾼 악보 튜닝 (앞뒤 곡에 다 있는 악보만). 없으면 undefined */
function changedTabs(before: Song, after: Song): Entry["tabs"] {
  const old = new Map(before.players.map((p) => [p.id, p.tab]));
  const out = new Map<string, { before: PlayerTab | undefined; after: PlayerTab | undefined }>();
  for (const p of after.players) {
    if (!old.has(p.id)) continue;
    const was = old.get(p.id);
    if (was?.tuning !== p.tab?.tuning || was?.capo !== p.tab?.capo) out.set(p.id, { before: was, after: p.tab });
  }
  return out.size ? out : undefined;
}

/** 기억한 타브 튜닝을 악보에 다시 얹는다 (기억이 없는 악보는 그대로) */
function keepTabs(next: Song, remembered: ReadonlyMap<string, PlayerTab | undefined>): Song {
  let changed = false;
  const players = next.players.map((p) => {
    if (!remembered.has(p.id)) return p;
    const tab = remembered.get(p.id);
    if (tab?.tuning === p.tab?.tuning && tab?.capo === p.tab?.capo) return p;
    changed = true;
    if (tab) return { ...p, tab };
    const { tab: _tab, ...rest } = p;
    return rest;
  });
  return changed ? { ...next, players } : next;
}

/** 곡 전체를 바꿔 끼우는 가장 단순한 명령. 되돌릴 때는 이전 곡으로 바꾼다. */
export function replaceSong(label: string, next: Song): Command {
  return {
    label,
    apply: () => next,
    invert: (before) => replaceSong(label, before),
  };
}
