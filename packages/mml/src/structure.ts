import { add, cmp, div, emptySong, fitNotes, INSTRUMENTS, tieChains, removeNotes, replaceNotes, meterGrid, trackInstrument, rat, sub, ZERO, type Command, type InstrumentRef, type Note, type Player, type PlayerTab, type Rat, type Song, type Track, type TrackRole } from "@mmlce/core";
import { keepTextEnd, setTracksNotes } from "./edit.js";

/** 트랙 색 (3MLE·마비꼬와 비슷한 6색을 차례로) */
const TRACK_COLORS = ["#4f8cff", "#ff7a59", "#2bb673", "#b061ff", "#f2b705", "#00b8d9"];

/** 지금 곡에 없는 id (prefix + 지금 가장 큰 번호 + 1). 지운 트랙의 음소거 등은 History가 새 트랙에 물려주지 않는다 */
function nextId(prefix: string, used: readonly string[]): string {
  let max = 0;
  for (const id of used) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/**
 * 트랙이 다 빠진 연주자를 지운다. 지운 악보를 원래 악보(splitFrom)로 가리키던 악보는 그 연결을 지운다
 * (나중에 같은 id로 만든 새 악보를 원래 악보로 잘못 보지 않게)
 */
function dropEmptyPlayer(song: Song, tracks: readonly Track[], playerId: string): readonly Player[] {
  if (tracks.some((t) => t.playerId === playerId)) return song.players;
  return song.players.filter((p) => p.id !== playerId).map((p) => (p.splitFrom === playerId ? withoutSplitFrom(p) : p));
}

function withoutSplitFrom(player: Player): Player {
  const { splitFrom: _from, ...rest } = player;
  return rest;
}

function sameInstrument(a: Player["instrument"], b: Player["instrument"]): boolean {
  return a.canonical === b.canonical && a.packId === b.packId && a.program === b.program;
}

/**
 * 고른 사운드팩에 맞춘 악기 번호 (마비꼬 팩 번호 부분). 팩 목록을 아는 쪽(앱)이 준다.
 * 받은 ref는 악기·팩이 바뀐 뒤의 값이고, undefined를 돌려주면 번호를 적지 않는다
 */
export type ProgramForPack = (ref: InstrumentRef) => number | undefined;

/** packId(고른 팩 파일 이름)를 주면 그 팩을 남기고, programFor로 번호를 그 팩에 맞춘다 */
function instrumentRef(canonical: string, packId?: string, programFor?: ProgramForPack): Player["instrument"] {
  const program = INSTRUMENTS.find((i) => i.id === canonical)?.program;
  const base: InstrumentRef = program === undefined ? { canonical } : { canonical, program };
  if (packId === undefined) return base;
  return withProgram({ ...base, packId }, programFor);
}

function withProgram(ref: InstrumentRef, programFor: ProgramForPack | undefined): InstrumentRef {
  if (!programFor) return ref;
  const { program: _old, ...rest } = ref;
  const program = programFor(ref);
  return program === undefined ? rest : { ...rest, program };
}

function blankTrack(id: string, playerId: string, name: string, index: number): Track {
  return {
    id,
    playerId,
    name,
    color: TRACK_COLORS[index % TRACK_COLORS.length]!,
    role: "free",
    mute: false,
    solo: false,
    notes: [],
    spelling: {},
    mml: { text: "" },
  };
}

/** 빈 악보: 연주자 하나(기본 피아노)와 빈 트랙 하나, 기본 템포(t120), 4/4 */
export function newSong(options: { title?: string; playerName: string; trackName: string; canonical?: string; profileId?: string }): Song {
  const base = emptySong({ title: options.title ?? "", author: "", profileId: options.profileId ?? "mobile" });
  const player: Player = { id: "p1", name: options.playerName, instrument: instrumentRef(options.canonical ?? "piano") };
  return {
    ...base,
    // 템포는 적지 않는다(기본 t120). 글에 t를 쓰면 그때 곡 템포가 된다
    tempo: [],
    timeSig: [{ at: rat(0), beats: 4, unit: 4 }],
    players: [player],
    tracks: [blankTrack("t1", player.id, options.trackName, 0)],
  };
}

function replaceWith(label: string, change: (song: Song) => Song): Command {
  const command: Command = {
    label,
    apply: change,
    invert: (before) => ({ label, apply: () => before, invert: () => command }),
  };
  return command;
}

/** 연주자를 더한다. 빈 트랙 하나를 함께 만든다 */
export function addPlayer(canonical: string, playerName: string, trackName: string, label = "연주자 추가"): Command {
  return replaceWith(label, (song) => {
    const playerId = nextId("p", song.players.map((p) => p.id));
    const trackId = nextId("t", song.tracks.map((t) => t.id));
    return {
      ...song,
      players: [...song.players, { id: playerId, name: playerName, instrument: instrumentRef(canonical) }],
      tracks: [...song.tracks, blankTrack(trackId, playerId, trackName, song.tracks.length)],
    };
  });
}

/**
 * 연주자의 악기를 바꾼다 (이름이 악기 이름 그대로였으면 이름도 바꾼다).
 * split을 주면 장식품 악기(오르골·축음기)로 바꿀 때 트랙에 따로 정한 악기를 정리한다 (splitSoloTracks)
 */
export function setPlayerInstrument(
  playerId: string,
  canonical: string,
  names?: { from: string; to: string },
  label = "악기 바꾸기",
  split?: SoloSplit,
  programFor?: ProgramForPack,
): Command {
  return replaceWith(label, (song) => {
    const next = {
      ...song,
      players: song.players.map((p) =>
        p.id !== playerId
          ? p
          : // 고른 사운드팩은 악기를 바꿔도 남긴다
            { ...p, instrument: instrumentRef(canonical, p.instrument.packId, programFor), name: names && p.name === names.from ? names.to : p.name },
      ),
    };
    if (!split) return next;
    return split.solo(canonical) ? splitSoloTracks(next, playerId, split) : mergeSplitBack(next, playerId, split);
  });
}

/**
 * 원래 악보로 돌아갈 수 있는데 한도 때문에 남은 악보와 트랙 수 (돌려보내기 뒤의 곡으로 센다).
 * owner를 보통 악기로 바꾼 뒤에 부른다
 */
export function blockedSplitBack(song: Song, playerId: string, split: SoloSplit): { playerId: string; tracks: number }[] {
  const owner = song.players.find((p) => p.id === playerId);
  if (!owner || split.solo(owner.instrument.canonical)) return [];
  return song.players
    .filter((p) => p.splitFrom === playerId)
    .map((p) => ({ playerId: p.id, tracks: song.tracks.filter((t) => t.playerId === p.id && !split.solo(trackInstrument(song, t).canonical)).length }))
    .filter((b) => b.tracks > 0);
}

/** 장식품 악기 악보를 정리할 때 쓰는 정보 */
export interface SoloSplit {
  /** 연주자가 아니라 장식품이 치는 악기인지 (오르골·축음기. GameProfile.soloInstruments) */
  readonly solo: (canonical: string) => boolean;
  /** 떼어 낸 트랙을 담을 새 악보 이름. 그 순간의 곡을 보고 번호를 붙인다 */
  readonly name: (song: Song, canonical: string) => string;
  /** 게임 악보 하나의 트랙 한도 (profile.maxChordsPerPlayer). 돌려보낼 때 넘지 않게 */
  readonly limit: number;
}

/**
 * 오르골·축음기 악보를 다시 보통 악기로 바꿨을 때, 그 악보에서 떼어 냈던 악보(splitFrom)의 트랙을 원래 악보 끝으로 돌려보낸다.
 * 트랙은 쓰던 악기를 트랙 악기로 가져가고(악보 악기와 같으면 지운다), 한도를 넘으면 그 악보는 그대로 둔다.
 * 실제로 치는 악기가 장식품(오르골·축음기)인 트랙은 보통 악보에 둘 수 없으므로 돌려보내지 않는다.
 * 다 돌려보낸 악보는 트랙이 없어져 지워지고(moveTrack), 그 악보에서 다시 떼어 냈던 악보(A→B→C의 C)는
 * 이제 A에서 떼어 낸 악보가 되어 같은 번에 차례로 돌려보낸다. 남은 악보(B)에서 떼어 낸 악보는 B를 따라 남는다
 */
export function mergeSplitBack(song: Song, playerId: string, split: SoloSplit): Song {
  const owner = song.players.find((p) => p.id === playerId);
  if (!owner || split.solo(owner.instrument.canonical)) return song;
  const childrenOf = (id: string) => song.players.filter((p) => p.splitFrom === id && p.id !== playerId).map((p) => p.id);
  const queue = childrenOf(playerId);
  const seen = new Set<string>([playerId, ...queue]);
  /** 원래 악보가 다 돌아가 지워져, 이제 owner에서 떼어 낸 악보로 이어 받은 악보 */
  const adopted: string[] = [];
  let next = song;
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const ids = next.tracks.filter((t) => t.playerId === id && !split.solo(trackInstrument(next, t).canonical)).map((t) => t.id);
    if (ids.length > 0 && tracksOf(next, playerId).length + ids.length <= split.limit)
      for (const t of ids) next = moveTrack(t, playerId, Number.MAX_SAFE_INTEGER).apply(next);
    if (next.players.some((p) => p.id === id)) continue;
    for (const child of childrenOf(id)) {
      if (seen.has(child)) continue;
      seen.add(child);
      adopted.push(child);
      queue.push(child);
    }
  }
  if (next === song) return song;
  return {
    ...next,
    // 지워진 악보를 가리키던 연결은 moveTrack이 지우므로, 이어 받은 악보는 owner를 가리키게 다시 적는다
    players: next.players.map((p) => (adopted.includes(p.id) ? { ...p, splitFrom: playerId } : p)),
    tracks: next.tracks.map((t) => (t.playerId === playerId && t.instrument && sameInstrument(t.instrument, owner.instrument) ? withoutInstrument(t) : t)),
  };
}

function withoutInstrument(track: Track): Track {
  const { instrument: _own, ...rest } = track;
  return rest;
}

/**
 * 장식품 악기(오르골·축음기)는 악보의 모든 트랙을 그 악기 하나로 치고, 연주자 악기처럼 트랙 하나에만 줄 수도 없다.
 * 그래서 연주자 playerId의 트랙 중 게임에서 그대로 낼 수 없는 트랙 악기를 새 악보로 떼어 낸다.
 * - 악보 악기가 장식품이면: 악보 악기와 같은 트랙 악기(팩·번호까지 같을 때만)는 지우고, 다른 보통 악기 트랙은 새 악보 하나로 모은다
 *   (첫 트랙 악기가 새 악보 악기, 나머지는 트랙 악기 그대로 = 게임의 "첫 연주자 + 한 명씩")
 * - 트랙 악기가 장식품이고 악보 악기와 다르면: 그 악기마다 새 장식품 악보 하나로 모은다
 * 트랙 순서는 그대로 따라가고, 떼어 낸 트랙이 없으면 곡을 그대로 돌려준다. 트랙이 다 빠진 연주자는 지운다 (moveTrack과 같게)
 */
export function splitSoloTracks(song: Song, playerId: string, split: SoloSplit): Song {
  const owner = song.players.find((p) => p.id === playerId);
  if (!owner) return song;
  const ownerSolo = split.solo(owner.instrument.canonical);
  let next = ownerSolo
    ? { ...song, tracks: song.tracks.map((t) => (t.playerId === playerId && t.instrument && sameInstrument(t.instrument, owner.instrument) ? withoutInstrument(t) : t)) }
    : song;
  // 새 악보 하나에 모을 트랙 묶음: 보통 악기 트랙은 "" 하나로, 장식품 악기 트랙은 그 악기마다
  const buckets = new Map<string, Track[]>();
  for (const t of next.tracks) {
    if (t.playerId !== playerId || !t.instrument || sameInstrument(t.instrument, owner.instrument)) continue;
    const solo = split.solo(t.instrument.canonical);
    if (!solo && !ownerSolo) continue;
    const key = solo ? t.instrument.canonical : "";
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  for (const list of buckets.values()) {
    const instrument = list[0]!.instrument!;
    const id = nextId("p", next.players.map((p) => p.id));
    next = { ...next, players: [...next.players, { id, name: split.name(next, instrument.canonical), instrument, splitFrom: playerId }] };
    list.forEach((t, i) => (next = moveTrack(t.id, id, i).apply(next)));
    next = { ...next, tracks: next.tracks.map((t) => (t.playerId === id && t.instrument && sameInstrument(t.instrument, instrument) ? withoutInstrument(t) : t)) };
  }
  return next;
}

/** 연주자 마지막 트랙 뒤에 빈 트랙을 더한다 */
export function addTrack(playerId: string, trackName: string, label = "트랙 추가"): Command {
  return replaceWith(label, (song) => {
    if (!song.players.some((p) => p.id === playerId)) return song;
    const id = nextId("t", song.tracks.map((t) => t.id));
    const last = song.tracks.map((t) => t.playerId).lastIndexOf(playerId);
    const tracks = [...song.tracks];
    tracks.splice(last + 1, 0, blankTrack(id, playerId, trackName, song.tracks.length));
    return { ...song, tracks };
  });
}

/**
 * 연주자 마지막 트랙 뒤에 트랙을 더하고 음을 넣는다 (실행 취소 한 칸).
 * 타브에서 화음 음이 들어갈 빈 트랙이 없을 때 쓴다.
 * instrument를 주면 새 트랙도 그 악기로 정한다 (고른 트랙만 악기를 바꾼 경우)
 */
export function addTrackWithNotes(
  playerId: string,
  trackName: string,
  notes: readonly Note[],
  label = "트랙 추가",
  instrument?: InstrumentRef,
): Command {
  return replaceWith(label, (song) => {
    const added = addTrack(playerId, trackName).apply(song);
    const fresh = added.tracks.find((t) => !song.tracks.some((o) => o.id === t.id));
    if (!fresh) return song;
    return {
      ...added,
      tracks: added.tracks.map((t) => {
        if (t.id !== fresh.id) return t;
        // 원문은 음에서 다시 만든다 (setTracksNotes와 같게)
        const { mml: _mml, ...rest } = t;
        return { ...rest, notes: [...notes], ...(instrument ? { instrument } : {}) };
      }),
    };
  });
}

/**
 * MIDI 건반 화음: 여러 트랙 음 바꾸기(setTracksNotes처럼 원문 끝 쉼표를 지킨다)와 같은 악보에 트랙 더하기를 실행 취소 한 칸으로.
 * newTracks: playerId 악보에 더할 트랙의 음, trackName(n): 그 악보의 n번째 트랙이 될 새 트랙 이름,
 * instrument: 새 트랙에 줄 악기 (고른 트랙만 악기를 바꾼 경우)
 */
export function setTracksNotesAddingTracks(
  playerId: string,
  changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[],
  newTracks: readonly (readonly Note[])[],
  trackName: (n: number) => string,
  label: string,
  instrument?: InstrumentRef,
): Command {
  if (newTracks.length === 0) return setTracksNotes(changes, label);
  return replaceWith(label, (song) => {
    let next = changes.length > 0 ? setTracksNotes(changes).apply(song) : song;
    for (const notes of newTracks) {
      const n = next.tracks.filter((t) => t.playerId === playerId).length + 1;
      next = addTrackWithNotes(playerId, trackName(n), notes, label, instrument).apply(next);
    }
    return next;
  });
}

/**
 * 여러 트랙 음 바꾸기와 같은 악보에 트랙 더하기를 실행 취소 한 칸으로 (아르페지오 등).
 * changes: 바꿀 트랙과 바뀐 뒤 음 전체 (원문은 음에서 다시 만든다), newTracks: playerId 악보에 더할 트랙의 음.
 * trackName(n): 그 악보의 n번째 트랙이 될 새 트랙 이름
 */
export function setNotesAndAddTracks(
  playerId: string,
  changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[],
  newTracks: readonly (readonly Note[])[],
  trackName: (n: number) => string,
  label: string,
): Command {
  return replaceWith(label, (song) => {
    const byId = new Map(changes.map((c) => [c.trackId, c.notes]));
    let next: Song = {
      ...song,
      tracks: song.tracks.map((t) => {
        const notes = byId.get(t.id);
        if (!notes) return t;
        const { mml: _mml, ...rest } = t;
        return { ...rest, notes: [...notes] };
      }),
    };
    // 원문 끝 쉼표로 지키던 악보 길이는 음이 다른 트랙으로 옮겨 가도 지킨다 (트랙 접기로 비운 트랙 등)
    next = keepTextEnd(song, next, [...byId.keys()], "tail");
    for (const notes of newTracks) {
      const n = next.tracks.filter((t) => t.playerId === playerId).length + 1;
      next = addTrackWithNotes(playerId, trackName(n), notes).apply(next);
    }
    return next;
  });
}

/** 트랙을 지운다. 연주자에게 남은 트랙이 없으면 연주자도 지운다 (곡 템포는 그대로) */
export function removeTrack(trackId: string, label = "트랙 지우기"): Command {
  return replaceWith(label, (song) => {
    const track = song.tracks.find((t) => t.id === trackId);
    if (!track) return song;
    const tracks = song.tracks.filter((t) => t.id !== trackId);
    const players = dropEmptyPlayer(song, tracks, track.playerId);
    return { ...song, tracks, players };
  });
}

/** 연주자(악보)의 트랙 id를 순서대로 */
function tracksOf(song: Song, playerId: string): string[] {
  return song.tracks.filter((t) => t.playerId === playerId).map((t) => t.id);
}

/**
 * 트랙을 옮길 수 있는지. 못 옮기면 까닭: "missing"(트랙·연주자 없음), "full"(받는 연주자 트랙이 이미 limit개).
 * 같은 연주자 안에서 순서만 바꾸는 것은 늘 된다
 */
export function trackMoveBlock(song: Song, trackId: string, playerId: string, limit: number): "missing" | "full" | undefined {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track || !song.players.some((p) => p.id === playerId)) return "missing";
  if (track.playerId !== playerId && tracksOf(song, playerId).length >= limit) return "full";
  return undefined;
}

/**
 * 트랙을 연주자 playerId의 index번째 자리(0부터, 옮길 트랙을 뺀 순서 기준)로 옮긴다.
 * 다른 연주자로 옮겨 보낸 연주자에게 트랙이 안 남으면 그 연주자를 지운다 (트랙 지우기와 같게).
 * 음·원문·악기는 그대로라 게임 묶음(악보 번호)만 다시 계산된다 (연주자 악기를 따르던 트랙은 그 악기를 트랙에 적어 간다)
 */
export function moveTrack(trackId: string, playerId: string, index: number, label = "트랙 옮기기"): Command {
  return replaceWith(label, (song) => {
    const track = song.tracks.find((t) => t.id === trackId);
    if (!track || !song.players.some((p) => p.id === playerId)) return song;
    const rest = song.tracks.filter((t) => t.id !== trackId);
    const siblings = rest.filter((t) => t.playerId === playerId);
    const at = Math.max(0, Math.min(index, siblings.length));
    // 연주자 악기를 따르던 트랙이 악기가 다른 연주자로 가면, 쓰던 악기를 트랙에 적어 소리가 바뀌지 않게 한다
    const owner = song.players.find((p) => p.id === track.playerId);
    const dest = song.players.find((p) => p.id === playerId);
    const keep = track.playerId !== playerId && !track.instrument && owner && dest && !sameInstrument(owner.instrument, dest.instrument);
    const moved: Track = keep ? { ...track, playerId, instrument: owner.instrument } : { ...track, playerId };
    let pos: number;
    if (at < siblings.length) pos = rest.indexOf(siblings[at]!);
    else if (siblings.length > 0) pos = rest.indexOf(siblings[siblings.length - 1]!) + 1;
    else {
      // 트랙이 없는 연주자: 연주자 순서에서 앞 연주자들의 트랙 뒤에 둔다
      const order = song.players.map((p) => p.id);
      const before = new Set(order.slice(0, order.indexOf(playerId)));
      pos = rest.reduce((last, t, i) => (before.has(t.playerId) ? i + 1 : last), 0);
    }
    // 제자리면 곡을 그대로 돌려준다 (실행 취소 기록에 빈 단계가 안 생기게)
    if (track.playerId === playerId && song.tracks.indexOf(track) === pos) return song;
    const tracks = [...rest.slice(0, pos), moved, ...rest.slice(pos)];
    const players = dropEmptyPlayer(song, tracks, track.playerId);
    return { ...song, tracks, players };
  });
}

/** 같은 연주자 안에서 한 칸 위(-1)·아래(+1)로. 끝이면 그대로 */
export function shiftTrack(trackId: string, step: -1 | 1, label = "트랙 옮기기"): Command {
  return replaceWith(label, (song) => {
    const track = song.tracks.find((t) => t.id === trackId);
    if (!track) return song;
    const index = tracksOf(song, track.playerId).indexOf(trackId) + step;
    if (index < 0 || index >= tracksOf(song, track.playerId).length) return song;
    return moveTrack(trackId, track.playerId, index, label).apply(song);
  });
}

/**
 * 트랙을 바로 아래에 복제한다. 새 트랙 id와 음 id를 새로 붙이고, 끄기·솔로는 풀어 둔다.
 * 원문 글·악기·채널 볼륨은 그대로 따라간다
 */
export function duplicateTrack(trackId: string, name: string, label = "트랙 복제"): Command {
  return replaceWith(label, (song) => {
    const index = song.tracks.findIndex((t) => t.id === trackId);
    const track = song.tracks[index];
    if (!track) return song;
    const id = nextId("t", song.tracks.map((t) => t.id));
    const used = new Set(song.tracks.flatMap((t) => t.notes.map((n) => n.id)));
    let k = 0;
    const notes = track.notes.map((n): Note => {
      let noteId: string;
      do noteId = `${id}.n${++k}`;
      while (used.has(noteId));
      // 복사한 트랙의 음은 만든 기록 표시를 떼어 보통 음으로
      const { made: _made, ...plain } = n;
      return { ...plain, id: noteId };
    });
    const copy: Track = { ...track, id, name, color: TRACK_COLORS[song.tracks.length % TRACK_COLORS.length]!, mute: false, solo: false, notes };
    const tracks = [...song.tracks];
    tracks.splice(index + 1, 0, copy);
    return { ...song, tracks };
  });
}

/** 트랙을 새 연주자(악보)로 떼어 낸다. 새 연주자 악기는 트랙이 실제로 쓰던 악기 */
export function moveTrackToNewPlayer(trackId: string, playerName: string, label = "새 악보로"): Command {
  return replaceWith(label, (song) => {
    const track = song.tracks.find((t) => t.id === trackId);
    const owner = song.players.find((p) => p.id === track?.playerId);
    if (!track || !owner) return song;
    const playerId = nextId("p", song.players.map((p) => p.id));
    const instrument = track.instrument ?? owner.instrument;
    const { instrument: _own, ...plain } = track;
    const withPlayer = { ...song, players: [...song.players, { id: playerId, name: playerName, instrument }] };
    const moved = moveTrack(trackId, playerId, 0, label).apply(withPlayer);
    return { ...moved, tracks: moved.tracks.map((t) => (t.id === trackId ? { ...plain, playerId } : t)) };
  });
}

/** 트랙을 복제해 그 복제본만 든 새 연주자(악보)로 보낸다. 원래 트랙은 그대로 */
export function duplicateTrackToNewPlayer(trackId: string, name: string, playerName: string, label = "새 악보로 복제"): Command {
  return replaceWith(label, (song) => {
    const copied = duplicateTrack(trackId, name, label).apply(song);
    const copy = copied.tracks.find((t) => !song.tracks.some((o) => o.id === t.id));
    return copy ? moveTrackToNewPlayer(copy.id, playerName, label).apply(copied) : song;
  });
}

/**
 * 박자표를 at 자리부터 바꾼다 (at은 마디 시작이어야 한다). 앞 박자와 같아지면 그 바뀜을 지운다.
 * 박자표가 없던 곡은 0 자리에 넣는다.
 */
export function setMeter(at: Rat, beats: number, unit: number, label = "박자 바꾸기"): Command {
  return replaceWith(label, (song) => {
    // 박자표가 없던 곡은 처음을 4/4로 둔다 (중간 바뀜만 있으면 저장할 때 첫 박자로 읽힌다)
    const base = song.timeSig.some((s) => cmp(s.at, ZERO) === 0) ? song.timeSig : [{ at: ZERO, beats: 4, unit: 4 }, ...song.timeSig];
    const timeSig = [...base.filter((s) => cmp(s.at, at) !== 0), { at, beats, unit }].sort((a, b) => cmp(a.at, b.at));
    // 앞 박자와 같아진 바뀜은 지운다. 다만 그 자리가 앞 박자의 마디 경계일 때만 (아니면 마디 시작이 달라진다)
    const merged = timeSig.filter((s, i) => {
      const prev = timeSig[i - 1];
      if (!prev || s.beats !== prev.beats || s.unit !== prev.unit) return true;
      const bars = div(sub(s.at, prev.at), meterGrid(prev).measure);
      return bars.d !== 1;
    });
    return { ...song, timeSig: merged };
  });
}

/** 박자 바뀜을 지운다. 곡 처음 박자는 지우지 않는다 (지울 것이 없으면 그대로) */
export function removeMeter(at: Rat, label = "박자 지우기"): Command {
  return replaceWith(label, (song) =>
    cmp(at, ZERO) === 0 || !song.timeSig.some((s) => cmp(s.at, at) === 0) ? song : { ...song, timeSig: song.timeSig.filter((s) => cmp(s.at, at) !== 0) },
  );
}

/** 마커를 넣거나(id 없음) 이름·위치를 고친다. 빈 이름은 무시 */
export function setMarker(id: string | undefined, at: Rat, text: string, label = "마커"): Command {
  return replaceWith(label, (song) => {
    const name = text.trim();
    if (!name) return song;
    const markers = id && song.markers.some((m) => m.id === id)
      ? song.markers.map((m) => (m.id === id ? { ...m, at, label: name } : m))
      : [...song.markers, { id: nextId("m", song.markers.map((m) => m.id)), at, label: name }];
    return { ...song, markers: [...markers].sort((a, b) => cmp(a.at, b.at)) };
  });
}

/** 마커를 옮긴다 */
export function moveMarker(id: string, to: Rat, label = "마커 옮기기"): Command {
  return replaceWith(label, (song) => {
    const marker = song.markers.find((m) => m.id === id);
    if (!marker || cmp(marker.at, to) === 0) return song;
    return { ...song, markers: song.markers.map((m) => (m.id === id ? { ...m, at: to } : m)).sort((a, b) => cmp(a.at, b.at)) };
  });
}

/** 마커를 지운다 */
export function removeMarker(id: string, label = "마커 지우기"): Command {
  return replaceWith(label, (song) => (song.markers.some((m) => m.id === id) ? { ...song, markers: song.markers.filter((m) => m.id !== id) } : song));
}

/** 트랙 이름을 바꾼다 (빈 이름은 무시) */
export function renameTrack(trackId: string, name: string, label = "트랙 이름"): Command {
  return replaceWith(label, (song) =>
    name.trim() === "" ? song : { ...song, tracks: song.tracks.map((t) => (t.id === trackId ? { ...t, name: name.trim() } : t)) },
  );
}

/** 트랙 역할 (멜로디 표시 등). 음은 그대로 */
export function setTrackRole(trackId: string, role: TrackRole, label = "트랙 역할"): Command {
  return replaceWith(label, (song) =>
    song.tracks.some((t) => t.id === trackId && t.role !== role) ? { ...song, tracks: song.tracks.map((t) => (t.id === trackId ? { ...t, role } : t)) } : song,
  );
}

/** 악보(연주자) 이름을 바꾼다 (빈 이름은 무시) */
export function renamePlayer(playerId: string, name: string, label = "악보 이름"): Command {
  return replaceWith(label, (song) =>
    name.trim() === "" ? song : { ...song, players: song.players.map((p) => (p.id === playerId ? { ...p, name: name.trim() } : p)) },
  );
}

/** 악보의 타브 튜닝·카포를 정한다. 같은 값이면 곡을 그대로 돌려준다. 앱은 실행 취소 기록 밖(History.amend)으로 쓴다 */
export function setPlayerTab(playerId: string, tab: PlayerTab, label = "튜닝"): Command {
  return replaceWith(label, (song) => {
    const player = song.players.find((p) => p.id === playerId);
    if (!player || (player.tab?.tuning === tab.tuning && player.tab.capo === tab.capo)) return song;
    return { ...song, players: song.players.map((p) => (p === player ? { ...p, tab: { tuning: tab.tuning, capo: tab.capo } } : p)) };
  });
}

/**
 * 트랙 하나만 다른 악기로 (canonical이 없거나 악보 악기와 같으면 악보 악기를 따르게 되돌린다).
 * 트랙이 듣던 사운드팩(고른 팩)은 남긴다. 그 팩이 악보 악기의 팩과 다르면 악보 악기와 같은 악기라도 트랙 악기로 둔다.
 * split을 주면 게임에서 같은 악보에 둘 수 없는 조합(오르골 악보의 다른 악기, 장식품 악기 트랙)은 새 악보로 떼어 낸다
 */
export function setTrackInstrument(
  trackId: string,
  canonical: string | undefined,
  label = "트랙 악기",
  split?: SoloSplit,
  programFor?: ProgramForPack,
): Command {
  return replaceWith(label, (song) => {
    const next = {
      ...song,
      tracks: song.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const player = song.players.find((p) => p.id === t.playerId);
        const rest = withoutInstrument(t);
        const packId = trackInstrument(song, t).packId;
        if (canonical === undefined || (canonical === player?.instrument.canonical && packId === player.instrument.packId)) return rest;
        return { ...rest, instrument: instrumentRef(canonical, packId, programFor) };
      }),
    };
    const playerId = song.tracks.find((t) => t.id === trackId)?.playerId;
    return split && playerId ? splitSoloTracks(next, playerId, split) : next;
  });
}

/**
 * 트랙에서 들을 사운드팩을 고른다 (packId: 팩 파일 이름, undefined면 자동). 악기 고르기와 같은 대상에 적용한다:
 * 트랙 악기가 있으면 그 트랙, 없으면 그 트랙의 악보(연주자) 악기. programFor로 악기 번호의 팩 번호 부분을 맞춘다
 */
export function setTrackPack(trackId: string, packId: string | undefined, programFor?: ProgramForPack, label = "사운드팩"): Command {
  const withPack = (ref: InstrumentRef): InstrumentRef => {
    const { packId: _old, ...rest } = ref;
    return withProgram(packId === undefined ? rest : { ...rest, packId }, programFor);
  };
  return replaceWith(label, (song) => {
    const track = song.tracks.find((t) => t.id === trackId);
    if (!track) return song;
    if (!track.instrument) {
      return { ...song, players: song.players.map((p) => (p.id === track.playerId ? { ...p, instrument: withPack(p.instrument) } : p)) };
    }
    const player = song.players.find((p) => p.id === track.playerId);
    const own = withPack(track.instrument);
    return {
      ...song,
      tracks: song.tracks.map((t) => {
        if (t.id !== trackId) return t;
        // 악보 악기와 팩·번호까지 같아지면 악보 악기를 따르게 되돌린다
        return player && sameInstrument(own, player.instrument) ? withoutInstrument(t) : { ...t, instrument: own };
      }),
    };
  });
}

/** 음 옮기기·트랙 합치기 결과: 바뀐 곡과 옮긴 음·겹쳐서 못 옮긴 음 수 */
export interface MovePlan {
  readonly song: Song;
  readonly moved: number;
  readonly blocked: number;
  /** 음을 받은 트랙 */
  readonly targetId: string;
}

/**
 * 받는 트랙에 &로 이은 덩어리째 넣는다. 덩어리 중 한 음이라도 이미 있는 음과 겹치면 덩어리 전체를 보낸 트랙에 남긴다.
 * 넣은 덩어리의 끝 음은 &를 풀어 받는 트랙의 다른 음과 이어지지 않게 한다
 */
function moveInto(song: Song, sources: readonly { trackId: string; chains: readonly (readonly Note[])[] }[], targetId: string): MovePlan {
  const target = song.tracks.find((t) => t.id === targetId);
  if (!target) return { song, moved: 0, blocked: 0, targetId };
  const used = new Set(song.tracks.flatMap((t) => t.notes.map((n) => n.id)));
  let k = 0;
  const newId = () => {
    let id: string;
    do id = `${targetId}.m${++k}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  let targetNotes: readonly Note[] = target.notes;
  const removed = new Map<string, Set<string>>();
  let moved = 0;
  let blocked = 0;
  for (const src of sources) {
    if (src.trackId === targetId) continue;
    const gone = new Set<string>();
    for (const chain of src.chains) {
      if (fitNotes(targetNotes, chain).blocked.length > 0) {
        blocked += chain.length;
        continue;
      }
      const placed = chain.map((n, i): Note => ({ ...n, id: newId(), ...(i === chain.length - 1 ? { tie: "none" as const } : {}) }));
      targetNotes = replaceNotes(targetNotes, new Map(placed.map((n) => [n.id, n])));
      for (const n of chain) gone.add(n.id);
      moved += chain.length;
    }
    removed.set(src.trackId, gone);
  }
  const tracks = song.tracks.map((t) => {
    const gone = removed.get(t.id);
    const notes = t.id === targetId ? targetNotes : gone && gone.size > 0 ? removeNotes(t.notes, gone) : undefined;
    if (!notes) return t;
    // 음이 바뀐 트랙은 원문 글을 버리고 음에서 다시 쓴다 (setTracksNotes와 같게)
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes };
  });
  return { song: { ...song, tracks }, moved, blocked, targetId };
}

/**
 * 고른 음을 다른 트랙으로 옮긴다. to가 없으면 보낸 트랙의 연주자에게 새 트랙을 만들어 옮긴다.
 * &로 이은 음은 하나만 골라도 덩어리째 옮긴다. 받는 트랙에서 이미 소리 나는 자리와 겹치는 덩어리는 옮기지 않고 남긴다
 */
export function planMoveNotes(song: Song, fromId: string, noteIds: ReadonlySet<string>, to: string | { readonly newTrackName: string }): MovePlan {
  const from = song.tracks.find((t) => t.id === fromId);
  if (!from) return { song, moved: 0, blocked: 0, targetId: fromId };
  let base = song;
  let targetId: string;
  if (typeof to === "string") targetId = to;
  else {
    targetId = nextId("t", song.tracks.map((t) => t.id));
    const last = song.tracks.map((t) => t.playerId).lastIndexOf(from.playerId);
    const tracks = [...song.tracks];
    tracks.splice(last + 1, 0, blankTrack(targetId, from.playerId, to.newTrackName, song.tracks.length));
    base = { ...song, tracks };
  }
  const chains = tieChains(from.notes).filter((c) => c.some((n) => noteIds.has(n.id)));
  return moveInto(base, [{ trackId: fromId, chains }], targetId);
}

/** 여러 트랙의 음을 한 트랙(intoId)으로 합친다. 겹치는 음(덩어리)은 원래 트랙에 남긴다 (빈 트랙은 지우지 않는다) */
export function planMergeTracks(song: Song, sourceIds: readonly string[], intoId: string): MovePlan {
  const sources = sourceIds.flatMap((id) => {
    const t = song.tracks.find((x) => x.id === id);
    return t ? [{ trackId: id, chains: tieChains(t.notes) }] : [];
  });
  return moveInto(song, sources, intoId);
}

/** 계획한 결과를 실행 취소할 수 있는 명령으로 */
export function applyPlan(plan: MovePlan, label: string): Command {
  return replaceWith(label, () => plan.song);
}

/**
 * 트랙들(같은 악보)에 흩어진 음을 높이 순으로 다시 나눈다: 시간 순으로 훑으며 같은 때 시작하는 음은
 * 높은 음부터, 그 자리에서 비어 있는 가장 앞 트랙에 넣는다 (멜로디 → 화음1 → …). &로 이은 음은 한 덩어리로 옮긴다.
 * 원래 트랙들이 겹치지 않았으니 동시에 나는 음 수는 트랙 수 이하라 넣을 자리가 늘 있다.
 * order가 "low"면 낮은 음부터 앞 트랙에 넣는다 (베이스를 첫 트랙에 두고 싶을 때)
 */
export function planVoiceByPitch(song: Song, trackIds: readonly string[], order: "high" | "low" = "high"): MovePlan {
  const tracks = trackIds.flatMap((id) => song.tracks.filter((t) => t.id === id));
  if (tracks.length < 2) return { song, moved: 0, blocked: 0, targetId: trackIds[0] ?? "" };
  // &로 이은 음 덩어리
  const chains = tracks.flatMap((t) => tieChains(t.notes).map((notes) => ({ notes, from: t.id })));
  const startOf = (c: { notes: Note[] }) => c.notes[0]!.start;
  const endOf = (c: { notes: Note[] }) => {
    const last = c.notes[c.notes.length - 1]!;
    return add(last.start, last.dur);
  };
  const sign = order === "high" ? 1 : -1;
  chains.sort((a, b) => cmp(startOf(a), startOf(b)) || sign * (b.notes[0]!.pitch - a.notes[0]!.pitch));
  const busyUntil = tracks.map(() => rat(0));
  const out = tracks.map((): Note[] => []);
  let moved = 0;
  let blocked = 0;
  for (const c of chains) {
    let k = busyUntil.findIndex((until) => cmp(until, startOf(c)) <= 0);
    if (k < 0) {
      // 원래 트랙들이 이미 겹쳐 있던 경우만: 제자리에 둔다
      k = tracks.findIndex((t) => t.id === c.from);
      blocked += c.notes.length;
    } else if (tracks[k]!.id !== c.from) moved += c.notes.length;
    out[k]!.push(...c.notes);
    if (cmp(endOf(c), busyUntil[k]!) > 0) busyUntil[k] = endOf(c);
  }
  const byId = new Map(tracks.map((t, k) => [t.id, out[k]!.sort((a, b) => cmp(a.start, b.start))]));
  const changed = song.tracks.map((t) => {
    const notes = byId.get(t.id);
    if (!notes) return t;
    const same = notes.length === t.notes.length && notes.every((n) => t.notes.some((x) => x.id === n.id));
    if (same) return t;
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes };
  });
  return { song: { ...song, tracks: changed }, moved, blocked, targetId: tracks[0]!.id };
}
