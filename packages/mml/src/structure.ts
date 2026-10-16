import { add, cmp, div, emptySong, fitNotes, INSTRUMENTS, tieChains, removeNotes, replaceNotes, meterGrid, rat, sub, ZERO, type Command, type Note, type Player, type Rat, type Song, type Track, type TrackRole } from "@mmlce/core";

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

function sameInstrument(a: Player["instrument"], b: Player["instrument"]): boolean {
  return a.canonical === b.canonical && a.packId === b.packId && a.program === b.program;
}

function instrumentRef(canonical: string): Player["instrument"] {
  const program = INSTRUMENTS.find((i) => i.id === canonical)?.program;
  return program === undefined ? { canonical } : { canonical, program };
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

/** 연주자의 악기를 바꾼다 (이름이 악기 이름 그대로였으면 이름도 바꾼다) */
export function setPlayerInstrument(playerId: string, canonical: string, names?: { from: string; to: string }, label = "악기 바꾸기"): Command {
  return replaceWith(label, (song) => ({
    ...song,
    players: song.players.map((p) =>
      p.id !== playerId ? p : { ...p, instrument: instrumentRef(canonical), name: names && p.name === names.from ? names.to : p.name },
    ),
  }));
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

/** 트랙을 지운다. 연주자에게 남은 트랙이 없으면 연주자도 지운다 (곡 템포는 그대로) */
export function removeTrack(trackId: string, label = "트랙 지우기"): Command {
  return replaceWith(label, (song) => {
    const track = song.tracks.find((t) => t.id === trackId);
    if (!track) return song;
    const tracks = song.tracks.filter((t) => t.id !== trackId);
    const players = tracks.some((t) => t.playerId === track.playerId) ? song.players : song.players.filter((p) => p.id !== track.playerId);
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
    const players = tracks.some((t) => t.playerId === track.playerId) ? song.players : song.players.filter((p) => p.id !== track.playerId);
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
      return { ...n, id: noteId };
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

/** 트랙 하나만 다른 악기로 (canonical이 없거나 악보 악기와 같으면 악보 악기를 따르게 되돌린다) */
export function setTrackInstrument(trackId: string, canonical: string | undefined, label = "트랙 악기"): Command {
  return replaceWith(label, (song) => ({
    ...song,
    tracks: song.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const player = song.players.find((p) => p.id === t.playerId);
      const { instrument: _old, ...rest } = t;
      return canonical === undefined || canonical === player?.instrument.canonical ? rest : { ...rest, instrument: instrumentRef(canonical) };
    }),
  }));
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
