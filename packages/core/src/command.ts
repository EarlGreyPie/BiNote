import { samePlayerTab, type PlayerTab, type Song } from "./model.js";

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
  /** 이 단계를 실행 취소해 사라진 악보의 타브 튜닝과 그 표시. 다시 실행해 그 악보가 돌아오면 되살린다 */
  gone?: Map<string, SavedTab>;
  /**
   * 이 단계가 지운 악보의 지우기 직전 튜닝과 표시. 실행 취소로 그 악보가 돌아오면 되살린다 (앞 단계의 표시와 이어지게).
   * 다시 실행할 때마다 새로 적는다 (그 사이 고른 튜닝이 돌아오게)
   */
  removed?: Map<string, SavedTab>;
  /**
   * 이 단계가 직접 바꾼 악보 튜닝 (악보 id → 바꾸기 전·뒤). 튜닝은 보통 기록 밖이지만, 타브 숫자를 지키며 튜닝을 바꾸는
   * 단계처럼 음 높이와 튜닝을 함께 바꾼 단계는 실행 취소·다시 실행이 둘을 같이 되돌려야 타브가 어긋나지 않는다
   */
  tabs?: ReadonlyMap<string, { readonly before: PlayerTab | undefined; readonly after: PlayerTab | undefined }>;
  /**
   * tabs의 악보마다 이 단계 앞·뒤 튜닝의 표시(History.tabMarks). 실행 취소는 지금 표시가 뒤 표시일 때만 앞 튜닝·앞 표시로,
   * 다시 실행은 앞 표시일 때만 뒤 튜닝·뒤 표시로 돌린다. 값이 같아도 그 사이 따로 고른 튜닝(새 표시)은 덮지 않는다
   */
  marks?: ReadonlyMap<string, { readonly before: number | undefined; readonly after: number }>;
}

/** 기록에 맡겨 둔 악보 튜닝과 그 표시 (History.tabMarks) */
interface SavedTab {
  readonly tab: PlayerTab | undefined;
  readonly mark: number | undefined;
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
  /** 악보 id → 튜닝이 바뀔 때마다 새로 붙이는 표시. 기록 밖에서 고른 튜닝을 값이 아니라 바뀐 일로 알아본다 */
  private tabMarks = new Map<string, number>();
  private nextMark = 1;

  /** 마지막 run을 거절한 까닭. guard: 검사가 거절, range: 계산 중 분수 값이 안전한 정수 범위를 넘음 */
  private lastRefusal: "guard" | "range" | undefined;

  constructor(
    private current: Song,
    private readonly guard?: EditGuard,
  ) {
    this.rememberTabs();
  }

  /** 지금 곡의 악보 튜닝을 기억한다. 새로 만든 악보(같은 id를 쓰던 지운 악보 포함)는 그 악보 것으로 바뀐다 */
  private rememberTabs(): void {
    for (const p of this.current.players) {
      if (this.tabs.has(p.id) && sameTab(this.tabs.get(p.id), p.tab)) continue;
      this.tabs.set(p.id, p.tab);
      this.tabMarks.set(p.id, this.nextMark++);
    }
  }


  /** before에 있다가 after에서 사라진 악보의 지금 튜닝·표시. 없으면 undefined */
  private removedTabs(before: Song, after: Song): Map<string, SavedTab> | undefined {
    const live = new Set(after.players.map((p) => p.id));
    const out = new Map<string, SavedTab>();
    for (const p of before.players) if (!live.has(p.id)) out.set(p.id, { tab: this.tabs.get(p.id), mark: this.tabMarks.get(p.id) });
    return out.size ? out : undefined;
  }

  private restoreTab(id: string, saved: SavedTab): void {
    this.tabs.set(id, saved.tab);
    if (saved.mark === undefined) this.tabMarks.delete(id);
    else this.tabMarks.set(id, saved.mark);
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

  /** 마지막 run을 거절해(검사, 또는 분수 계산 범위 넘침) 곡이 그대로인지 */
  get refused(): boolean {
    return this.lastRefusal !== undefined;
  }

  /** 마지막 run을 거절한 까닭 (거절하지 않았으면 undefined) */
  get refusal(): "guard" | "range" | undefined {
    return this.lastRefusal;
  }

  /**
   * 명령을 실행해 기록에 넣는다. 검사(guard)가 거절하면 곡도 기록도 그대로 두고 지금 곡을 돌려준다 (refused가 true).
   * 명령이 곡을 그대로 돌려주면 기록하지 않는다.
   * 명령이나 검사가 RangeError(분수 값이 안전한 정수 범위를 넘음)를 던지면 앱을 멈추지 않고 같은 식으로 거절한다 (refusal이 "range").
   * unchecked: 검사를 일부러 건너뛰는 길 (MML 글 직접 입력처럼 쓴 글이 곧 출력인 편집)
   */
  run(command: Command, options?: { readonly unchecked?: boolean }): Song {
    const before = this.current;
    let after: Song;
    try {
      after = command.apply(before);
      this.lastRefusal =
        !options?.unchecked && after !== before && this.guard !== undefined && !this.guard(before, after, command) ? "guard" : undefined;
    } catch (e) {
      // 분수 값이 안전한 정수 범위를 넘으면(서로 다른 불규칙 음길이가 아주 많이 쌓인 곡 등) 앱을 멈추지 않고 이 편집만 거절한다
      if (!(e instanceof RangeError)) throw e;
      this.lastRefusal = "range";
      return before;
    }
    // 바뀐 것이 없으면 기록하지 않는다 (빈 실행 취소 칸이 생기지 않게)
    if (this.lastRefusal || after === before) return before;
    this.current = after;
    // 새로 생긴 트랙은 같은 id를 쓰던 예전 트랙의 음소거·솔로를 물려받지 않는다
    const existed = new Set(before.tracks.map((t) => t.id));
    for (const t of this.current.tracks) if (!existed.has(t.id)) this.listening.set(t.id, { mute: t.mute, solo: t.solo });
    const tabs = changedTabs(before, after);
    const marks = new Map<string, { before: number | undefined; after: number }>();
    for (const id of tabs?.keys() ?? []) {
      const mark = this.nextMark++;
      marks.set(id, { before: this.tabMarks.get(id), after: mark });
      this.tabs.set(id, after.players.find((p) => p.id === id)?.tab);
      this.tabMarks.set(id, mark);
    }
    const removed = this.removedTabs(before, after);
    this.undoStack.push({
      forward: command,
      backward: command.invert(before),
      ...(tabs ? { tabs, marks } : {}),
      ...(removed ? { removed } : {}),
    });
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
    // 그 단계 뒤에 보기 튜닝을 따로 고르지 않았을 때만 되돌린다 (나중에 고른 보기는 기록 밖 상태라 그대로 둔다)
    for (const [id, { before }] of entry.tabs ?? []) {
      const mark = entry.marks?.get(id);
      if (!mark || this.tabMarks.get(id) !== mark.after) continue;
      this.tabs.set(id, before);
      if (mark.before === undefined) this.tabMarks.delete(id);
      else this.tabMarks.set(id, mark.before);
    }
    // 이 단계가 만든 악보는 실행 취소로 사라진다: 그 튜닝은 이 단계에 맡겨 두고, 같은 id의 옛 악보가 돌아오면 그 악보 것을 쓴다
    const live = new Set(next.players.map((p) => p.id));
    for (const p of this.current.players) {
      if (live.has(p.id)) continue;
      (entry.gone ??= new Map()).set(p.id, { tab: this.tabs.get(p.id), mark: this.tabMarks.get(p.id) });
      this.tabs.delete(p.id);
      this.tabMarks.delete(p.id);
    }
    // 이 단계가 지운 악보가 돌아오면 지우기 전 튜닝·표시로 (그래야 그 앞 단계의 실행 취소가 표시를 알아본다)
    const was = new Set(this.current.players.map((p) => p.id));
    for (const [id, saved] of entry.removed ?? []) if (live.has(id) && !was.has(id)) this.restoreTab(id, saved);
    this.current = keepTabs(next, this.tabs);
    this.rememberTabs();
    this.redoStack.push(entry);
    return this.current;
  }

  redo(): Song {
    const entry = this.redoStack.pop();
    if (!entry) return this.current;
    for (const [id, saved] of entry.gone ?? []) this.restoreTab(id, saved);
    delete entry.gone;
    for (const [id, { after }] of entry.tabs ?? []) {
      const mark = entry.marks?.get(id);
      if (!mark || this.tabMarks.get(id) !== mark.before) continue;
      this.tabs.set(id, after);
      this.tabMarks.set(id, mark.after);
    }
    const next = keepTabs(keepListening(this.current, entry.forward.apply(this.current), this.listening), this.tabs);
    const removed = this.removedTabs(this.current, next);
    if (removed) entry.removed = removed;
    else delete entry.removed;
    this.current = next;
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

const sameTab = samePlayerTab;

/** 명령 하나가 바꾼 악보 튜닝 (앞뒤 곡에 다 있는 악보만). 없으면 undefined */
function changedTabs(before: Song, after: Song): Entry["tabs"] {
  const old = new Map(before.players.map((p) => [p.id, p.tab]));
  const out = new Map<string, { before: PlayerTab | undefined; after: PlayerTab | undefined }>();
  for (const p of after.players) {
    if (!old.has(p.id)) continue;
    const was = old.get(p.id);
    if (!sameTab(was, p.tab)) out.set(p.id, { before: was, after: p.tab });
  }
  return out.size ? out : undefined;
}

/** 기억한 타브 튜닝을 악보에 다시 얹는다 (기억이 없는 악보는 그대로) */
function keepTabs(next: Song, remembered: ReadonlyMap<string, PlayerTab | undefined>): Song {
  let changed = false;
  const players = next.players.map((p) => {
    if (!remembered.has(p.id)) return p;
    const tab = remembered.get(p.id);
    if (sameTab(tab, p.tab)) return p;
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
