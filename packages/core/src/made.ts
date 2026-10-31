import { add, cmp, sub, ZERO, type Rat } from "./rat.js";
import type { Extras, Note, Song } from "./model.js";

/**
 * 만든 기록: 아르페지오·꾸밈음·슬라이드·트릴 창으로 적용한 결과를 나중에 원래대로 되돌리거나, 옛 설정으로 창을 다시 열어 고치려고 남긴다.
 * 곡(Song.made)에 기록 하나, 만들거나 바꾼 음에는 기록 id(Note.made)만 붙는다. 프로젝트 파일(.mme)에만 저장되고
 * MML·3MLE·.mmi·MIDI 출력은 그대로다. 곡 안의 상태라 실행 취소·다시 실행이 함께 따른다.
 * 결과만 계산하고 곡은 바꾸지 않는다 (트랙에 넣는 것은 @mmlce/mml의 restoreMadeCommand)
 */

export type MadeTool = "arpeggio" | "grace" | "slide" | "trill";
export const MADE_TOOLS: readonly MadeTool[] = ["arpeggio", "grace", "slide", "trill"];

/** 트랙 하나의 음 묶음 */
export interface MadeNotes {
  readonly trackId: string;
  readonly notes: readonly Note[];
}

export interface MadeRecord {
  readonly id: string;
  readonly tool: MadeTool;
  /** 창에서 고른 설정 (JSON 값. 창마다 자기 모양으로 다시 검사한다) */
  readonly options: unknown;
  /** 창을 연 트랙 (아르페지오의 고른 트랙) */
  readonly trackId?: string;
  /** 처음 고른 음 id (다시 고치기에서 같은 음을 다시 고른다) */
  readonly picked: readonly string[];
  /** 바뀌기 전 원래 음: 지워졌거나 바뀐 음을 바뀌기 전 모습 그대로 (트랙마다) */
  readonly before: readonly MadeNotes[];
  /** 만든 뒤 음: 새로 생기거나 바뀐 음을 만든 때 모습으로 (나중에 손댔는지 알아본다. 기록 id는 빼고 적는다) */
  readonly after: readonly MadeNotes[];
  /** 이 기록이 새로 더한 트랙. 되돌린 뒤 비면 지운다 */
  readonly addedTracks?: readonly string[];
  readonly extras?: Extras;
}

/** 기록을 남길 때 창이 넘기는 것 */
export interface MadeInfo {
  readonly tool: MadeTool;
  readonly options: unknown;
  readonly trackId?: string;
  readonly picked: readonly string[];
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

/** 소리·표시까지 같은 음인지 (기록 id는 보지 않는다) */
function sameNote(a: Note, b: Note): boolean {
  return (
    cmp(a.start, b.start) === 0 &&
    cmp(a.dur, b.dur) === 0 &&
    a.pitch === b.pitch &&
    a.vol === b.vol &&
    a.tie === b.tie &&
    a.tabString === b.tabString &&
    JSON.stringify(a.lab) === JSON.stringify(b.lab)
  );
}

/** 손댔는지 볼 때 견주는 소리 (자리 옮김·조옮김은 따로 본다) */
const sameBody = (a: Note, b: Note) => cmp(a.dur, b.dur) === 0 && a.vol === b.vol && a.tie === b.tie;

function withoutMark(n: Note): Note {
  if (n.made === undefined) return n;
  const { made: _made, ...rest } = n;
  return rest;
}

/** 음에서 기록 id를 뗀다 (복사해 붙인 음은 보통 음이 된다) */
export function unmarkNotes(notes: readonly Note[]): Note[] {
  return notes.map(withoutMark);
}

/** 곡에서 쓰지 않은 기록 id */
function freshMadeId(song: Song): string {
  const used = new Set((song.made ?? []).map((r) => r.id));
  for (const t of song.tracks) for (const n of t.notes) if (n.made !== undefined) used.add(n.made);
  // 기록 안의 원래 음이 가리키는 id도 피한다 (되돌리면 그 표시가 다시 곡에 돌아온다)
  for (const r of song.made ?? []) for (const b of r.before) for (const n of b.notes) if (n.made !== undefined) used.add(n.made);
  for (let k = 1; ; k++) if (!used.has(`mk${k}`)) return `mk${k}`;
}

/**
 * 창 하나를 적용한 앞뒤 곡을 견주어 기록을 남긴 곡. 트랙마다 새로 생기거나 바뀐 음에 기록 id를 붙이고,
 * 지워졌거나 바뀐 음은 바뀌기 전 모습으로 기록에 적는다. 바뀐 것이 없으면 after 그대로
 */
export function recordMade(before: Song, after: Song, info: MadeInfo): Song {
  if (before === after) return after;
  const id = freshMadeId(after);
  const old = new Map(before.tracks.map((t) => [t.id, t]));
  const was: MadeNotes[] = [];
  const now: MadeNotes[] = [];
  const added: string[] = [];
  const tracks = after.tracks.map((t) => {
    const prev = old.get(t.id);
    if (prev && prev.notes === t.notes) return t;
    const prevById = new Map((prev?.notes ?? []).map((n) => [n.id, n]));
    const changed = new Set(t.notes.filter((n) => !prevById.has(n.id) || !sameNote(prevById.get(n.id)!, n)).map((n) => n.id));
    const nowIds = new Set(t.notes.map((n) => n.id));
    const gone = (prev?.notes ?? []).filter((n) => !nowIds.has(n.id) || changed.has(n.id));
    if (!prev && t.notes.length > 0) added.push(t.id);
    if (changed.size === 0 && gone.length === 0) return t;
    if (gone.length > 0) was.push({ trackId: t.id, notes: gone });
    if (changed.size === 0) return t;
    now.push({ trackId: t.id, notes: t.notes.filter((n) => changed.has(n.id)).map(withoutMark) });
    return { ...t, notes: t.notes.map((n) => (changed.has(n.id) ? { ...n, made: id } : n)) };
  });
  if (was.length === 0 && now.length === 0) return after;
  const record: MadeRecord = {
    id,
    tool: info.tool,
    options: info.options,
    ...(info.trackId !== undefined ? { trackId: info.trackId } : {}),
    picked: [...info.picked],
    before: was,
    after: now,
    ...(added.length > 0 ? { addedTracks: added } : {}),
  };
  return pruneMade({ ...after, tracks, made: [...(after.made ?? []), record] });
}

/** 기록 id → 그 기록이 붙은 음 (트랙과 함께) */
function markedBy(song: Song): Map<string, { trackId: string; note: Note }[]> {
  const out = new Map<string, { trackId: string; note: Note }[]>();
  for (const t of song.tracks)
    for (const n of t.notes) {
      if (n.made === undefined) continue;
      const list = out.get(n.made) ?? [];
      list.push({ trackId: t.id, note: n });
      out.set(n.made, list);
    }
  return out;
}

/**
 * 붙은 음이 하나도 없는 기록을 버리고, 없는 기록을 가리키는 음 표시를 뗀다 (저장할 때, 기록을 남길 때).
 * 살아 있는 기록의 원래 음(before)이 가리키는 앞 기록도 살린다 (만든 음을 다시 가공한 겹친 기록: 나중 것을 되돌리면 그 표시가 돌아온다).
 * 바뀐 것이 없으면 song 그대로
 */
export function pruneMade(song: Song): Song {
  const records = song.made ?? [];
  const marked = markedBy(song);
  const keep = new Set(records.filter((r) => marked.has(r.id)).map((r) => r.id));
  const byId = new Map(records.map((r) => [r.id, r]));
  const queue = [...keep];
  while (queue.length > 0) {
    const r = byId.get(queue.pop()!);
    for (const b of r?.before ?? [])
      for (const n of b.notes)
        if (n.made !== undefined && byId.has(n.made) && !keep.has(n.made)) {
          keep.add(n.made);
          queue.push(n.made);
        }
  }
  const live = records.filter((r) => keep.has(r.id));
  const ids = new Set(live.map((r) => r.id));
  const stale = [...marked.keys()].filter((id) => !ids.has(id));
  if (live.length === records.length && stale.length === 0) return song;
  const tracks =
    stale.length === 0
      ? song.tracks
      : song.tracks.map((t) => (t.notes.some((n) => n.made !== undefined && !ids.has(n.made)) ? { ...t, notes: t.notes.map((n) => (n.made !== undefined && !ids.has(n.made) ? withoutMark(n) : n)) } : t));
  const { made: _made, ...rest } = song;
  return { ...rest, tracks, ...(live.length > 0 ? { made: live } : {}) };
}

/**
 * 두 곡의 음과 만든 기록이 같은지 (트랙 순서·id와 음 목록이 같은 객체). 음소거·튜닝처럼 음을 바꾸지 않는 상태는 보지 않는다.
 * 되돌리기·다시 고치기 계획은 트랙 음 전체를 바꿔 끼우므로, 창을 연 사이(MIDI 건반 입력·녹음 등) 음이 바뀐 곡에는 넣지 않는다
 */
export function sameNotes(a: Song, b: Song): boolean {
  if (a === b) return true;
  if (a.made !== b.made || a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every((t, i) => t.id === b.tracks[i]!.id && t.notes === b.tracks[i]!.notes);
}

/** 고른 음에 붙은 기록 (만든 순서). 없는 기록을 가리키는 음은 보통 음으로 본다 */
export function madeOf(song: Song, noteIds: Iterable<string>): MadeRecord[] {
  const records = song.made ?? [];
  if (records.length === 0) return [];
  const ids = new Set(noteIds);
  const hit = new Set<string>();
  for (const t of song.tracks) for (const n of t.notes) if (n.made !== undefined && ids.has(n.id)) hit.add(n.made);
  return records.filter((r) => hit.has(r.id));
}

/** 되돌리기 계획 */
export type MadeRestore =
  | {
      readonly ok: true;
      /** 바꿀 트랙과 바뀐 뒤 음 전체 */
      readonly changes: readonly MadeNotes[];
      /** 지울 트랙 (기록이 더했고 되돌린 뒤 빈 트랙) */
      readonly removeTracks: readonly string[];
      /** 되돌린 뒤 곡의 기록 목록 */
      readonly made: readonly MadeRecord[];
      /** 만든 뒤 손댄 음 수 (옮김·높이·길이·v·& 가운데 하나라도 바뀜. 지운 음은 세지 않는다) */
      readonly edited: number;
      /** 돌려놓은 원래 음 id (기록에 적힌 id → 곡에 넣은 id. 같은 id를 다른 음이 쓰고 있으면 새 id) */
      readonly ids: ReadonlyMap<string, string>;
      /** 이 계획을 세운 곡. 음이 그 뒤에 바뀐 곡에는 넣지 않는다 (sameNotes) */
      readonly from: Song;
    }
  | {
      readonly ok: false;
      /**
       * occupied: 원래 음 자리에 나중에 넣은 다른 음이 있음 / nested: 그 음이 다른 창으로 만든 음 (그것부터 되돌려야 함)
       * track: 원래 음이 있던 트랙이 없어짐 / range: 함께 옮기면 곡 처음 앞이나 MIDI 범위 밖
       */
      readonly reason: "occupied" | "nested" | "track" | "range";
      /** 걸리는 음 id (occupied·nested) */
      readonly blocking: readonly string[];
    };

/**
 * 기록 하나의 만든 음이 만든 뒤 모두 같은 만큼 옮겨졌거나 조옮김됐는지 (곡 앞에 마디 넣기, 곡 전체 조옮김 등).
 * 만든 때 모습과 id로 맞는 음이 모두 같은 시간·높이 차일 때만 그 차를 원래 음에도 준다. 하나라도 다르게 움직였으면
 * (마디를 기록 한가운데에 넣어 앞뒤가 따로 움직임, 손으로 하나만 옮김) 옮기지 않고 제자리로 돌려놓으며, 다른 음은 손댄 음으로 센다
 */
function shiftOf(marked: readonly Note[], snapshot: readonly Note[]): { dt: Rat; dp: number; edited: ReadonlySet<string> } {
  const byId = new Map(snapshot.map((n) => [n.id, n]));
  let best: { dt: Rat; dp: number } | undefined;
  let uniform = true;
  for (const n of marked) {
    const s = byId.get(n.id);
    if (!s) continue;
    const dt = sub(n.start, s.start);
    const dp = n.pitch - s.pitch;
    if (!best) best = { dt, dp };
    else if (cmp(best.dt, dt) !== 0 || best.dp !== dp) uniform = false;
  }
  const shift = best && uniform ? best : { dt: ZERO, dp: 0 };
  // id가 같은 기록 음, 없으면(MML 글을 다시 읽어 id가 바뀜) 옮긴 만큼 같은 자리·높이·소리인 기록 음이 있으면 손대지 않은 음
  const matches = (n: Note, s: Note) => cmp(n.start, add(s.start, shift.dt)) === 0 && n.pitch === s.pitch + shift.dp && sameBody(s, n);
  const edited = new Set(
    marked
      .filter((n) => {
        const s = byId.get(n.id);
        return s ? !matches(n, s) : !snapshot.some((x) => matches(n, x));
      })
      .map((n) => n.id),
  );
  return { dt: shift.dt, dp: shift.dp, edited };
}

/** 기록이 걸친 트랙 (원래 음이 있던 트랙과 만든 음이 있는 트랙, 곡 트랙 순서). 되돌리기 창에서 고른다 */
export function madeTracks(song: Song, recordIds: Iterable<string>): string[] {
  const want = new Set(recordIds);
  const hit = new Set<string>();
  for (const r of song.made ?? []) if (want.has(r.id)) for (const b of r.before) hit.add(b.trackId);
  for (const t of song.tracks) if (t.notes.some((n) => n.made !== undefined && want.has(n.made))) hit.add(t.id);
  const order = song.tracks.map((t) => t.id);
  return [...hit].sort((a, b) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity));
}

/**
 * 고른 기록을 원래대로 되돌리는 계획 (나중에 만든 기록부터). 기록마다 그 기록 id가 붙은 음을 모두 지우고,
 * 원래 음을 기록에 적힌 트랙 제자리에 돌려놓는다 (만든 음이 모두 같이 옮겨졌으면 원래 음도 그만큼).
 * 돌려놓을 자리에 남는 음이 있으면 아무것도 바꾸지 않고 그 음을 알린다 (한 트랙은 한 번에 한 음, 곡을 덮어쓰지 않게).
 * tracks를 주면 그 트랙만 되돌린다 (아르페지오 되돌리기 창): 뺀 트랙은 그대로 둔다. 뺀 트랙에 만든 음이 있으면 그 트랙 몫만 기록에 남겨
 * 나중에 다시 되돌릴 수 있다
 */
export function restoreMade(song: Song, recordIds: Iterable<string>, tracks?: ReadonlySet<string>): MadeRestore {
  const included = (trackId: string) => !tracks || tracks.has(trackId);
  const want = new Set(recordIds);
  let records = [...(song.made ?? [])];
  const targets = records.filter((r) => want.has(r.id)).reverse();
  const notes = new Map(song.tracks.map((t) => [t.id, [...t.notes]]));
  const touched = new Set<string>();
  const ids = new Map<string, string>();
  let edited = 0;
  for (const record of targets) {
    const marked: { trackId: string; note: Note }[] = [];
    for (const [trackId, list] of notes) for (const n of list) if (n.made === record.id) marked.push({ trackId, note: n });
    const shift = shiftOf(
      marked.map((x) => x.note),
      record.after.flatMap((a) => a.notes),
    );
    edited += marked.filter((x) => included(x.trackId) && shift.edited.has(x.note.id)).length;
    const before = record.before.filter((b) => included(b.trackId));
    for (const b of before) if (!notes.has(b.trackId)) return { ok: false, reason: "track", blocking: [] };
    // 만든 음을 지운다
    for (const { trackId } of marked) if (included(trackId)) touched.add(trackId);
    for (const [trackId, list] of notes)
      if (included(trackId) && list.some((n) => n.made === record.id)) notes.set(trackId, list.filter((n) => n.made !== record.id));
    // 원래 음을 돌려놓는다
    const used = new Set([...notes.values()].flatMap((list) => list.map((n) => n.id)));
    const blocking = new Set<string>();
    for (const b of before) {
      const list = notes.get(b.trackId)!;
      const back: Note[] = [];
      for (const o of b.notes) {
        const start = add(o.start, shift.dt);
        const pitch = o.pitch + shift.dp;
        if (cmp(start, ZERO) < 0 || pitch < 0 || pitch > 127) return { ok: false, reason: "range", blocking: [] };
        let id = o.id;
        for (let k = 2; used.has(id); k++) id = `${o.id}~${k}`;
        used.add(id);
        ids.set(o.id, id);
        back.push({ ...o, id, start, pitch });
      }
      for (const n of back) for (const x of list) if (cmp(x.start, end(n)) < 0 && cmp(n.start, end(x)) < 0) blocking.add(x.id);
      notes.set(
        b.trackId,
        [...list, ...back].sort((p, q) => cmp(p.start, q.start)),
      );
      touched.add(b.trackId);
    }
    if (blocking.size > 0) {
      const live = new Set(records.map((r) => r.id));
      const nested = song.tracks.some((t) => t.notes.some((n) => blocking.has(n.id) && n.made !== undefined && live.has(n.made)));
      return { ok: false, reason: nested ? "nested" : "occupied", blocking: [...blocking] };
    }
    // 뺀 트랙에 만든 음이 남으면 그 트랙 몫만 기록에 남긴다 (만든 음이 없는 트랙 몫은 고를 음이 없어 버린다)
    const keep = (g: readonly MadeNotes[]) => g.filter((x) => !included(x.trackId));
    const left = marked.some((x) => !included(x.trackId));
    const added = (record.addedTracks ?? []).filter((id) => !included(id));
    const { addedTracks: _added, ...plain } = record;
    const rest: MadeRecord = { ...plain, before: keep(record.before), after: keep(record.after), ...(added.length > 0 ? { addedTracks: added } : {}) };
    records = left ? records.map((r) => (r === record ? rest : r)) : records.filter((r) => r !== record);
  }
  // 기록이 더한 트랙은 되돌린 뒤 비면 지운다 (다른 음을 넣은 트랙은 둔다)
  const removeTracks = targets.flatMap((r) => r.addedTracks ?? []).filter((id) => included(id) && notes.get(id)?.length === 0);
  const changes = [...touched].filter((id) => !removeTracks.includes(id)).map((trackId) => ({ trackId, notes: notes.get(trackId)! }));
  return { ok: true, changes, removeTracks, made: records, edited, ids, from: song };
}

/**
 * 기록 없는 음을 만든 음으로 알아본 곡 (아르페지오로 알아보기): after의 음에 새 기록 id를 붙이고, 짐작한 원래 음(before)과 함께 기록을 남긴다.
 * after 음 가운데 곡에 없거나 이미 살아 있는 기록이 붙은 음이 있으면 song 그대로
 */
export function adoptMade(song: Song, info: MadeInfo, before: readonly MadeNotes[], after: readonly MadeNotes[]): Song {
  const live = new Set((song.made ?? []).map((r) => r.id));
  const want = new Map<string, string>();
  for (const g of after) for (const n of g.notes) want.set(n.id, g.trackId);
  if (want.size === 0) return song;
  let found = 0;
  for (const t of song.tracks)
    for (const n of t.notes) {
      if (want.get(n.id) !== t.id) continue;
      if (n.made !== undefined && live.has(n.made)) return song;
      found++;
    }
  if (found !== want.size) return song;
  const id = freshMadeId(song);
  const tracks = song.tracks.map((t) => (t.notes.some((n) => want.get(n.id) === t.id) ? { ...t, notes: t.notes.map((n) => (want.get(n.id) === t.id ? { ...n, made: id } : n)) } : t));
  const now = tracks.flatMap((t) => {
    const notes = t.notes.filter((n) => n.made === id).map(withoutMark);
    return notes.length > 0 ? [{ trackId: t.id, notes }] : [];
  });
  const record: MadeRecord = { id, tool: info.tool, options: info.options, ...(info.trackId !== undefined ? { trackId: info.trackId } : {}), picked: [...info.picked], before: [...before], after: now };
  return pruneMade({ ...song, tracks, made: [...(song.made ?? []), record] });
}
