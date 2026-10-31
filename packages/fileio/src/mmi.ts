import {
  cmp,
  emptySong,
  mul,
  rat,
  sub,
  trackInstrument,
  ZERO,
  type Marker,
  type Player,
  type Rat,
  type Song,
  type TempoEvent,
  type TimeSigEvent,
  type Track,
} from "@mmlce/core";
import { audibleTempo, localAt, optimizeMml, sameTempo, spliceText, surgicalSource, tempoInsertOffset, tempoTokens } from "@mmlce/mml";
import { channelToTrack, idMaker, instrumentFromProgram, mergeTempo, type ChannelTempo, type FileDiagnostic } from "./common.js";
import type { ReadResult } from "./threemle.js";

/**
 * 마비꼬 .mmi 파일. 공개된 파일 구조만 보고 독자 구현한다.
 *
 * [mml-score]  title, author, time=4/4, tempo=96T150,192T120 (tick T bpm),
 *              mml-track=MML@멜로디,화음1,화음2[,노래]; (다음 줄들이 들여쓰기로 이어짐)
 *              그 뒤 name, program, songProgram, startDelta 등이 그 트랙에 붙는다
 * [marker]     tick=이름
 * [time-signature] tick=n/d
 *
 * tick은 4분음표 = 96 (PC 마비노기 기준).
 */
export const MMI_TPQN = 96;
const WHOLE_TICKS = MMI_TPQN * 4;

/** 파트·연주자 이름. 앱이 화면 언어로 넘긴다 (기본 한국어) */
export interface MmiNames {
  readonly parts: readonly [string, string, string, string];
  readonly songPlayer: (name: string) => string;
}

const KO_NAMES: MmiNames = { parts: ["멜로디", "화음1", "화음2", "노래"], songPlayer: (name) => `${name} 노래` };

interface RawTrack {
  mml: string;
  props: Map<string, string>;
}

function tickToRat(tick: number): Rat {
  return rat(tick, WHOLE_TICKS);
}

function ratToTick(at: Rat): { tick: number; exact: boolean } {
  const exact = mul(at, rat(WHOLE_TICKS));
  const tick = Math.round(exact.n / exact.d);
  return { tick, exact: exact.d === 1 };
}

/**
 * .mmi를 곡으로 읽는다. mml-track 하나가 연주자 하나이고,
 * 그 안의 멜로디·화음1·화음2(·노래)를 각각 화음별 트랙으로 푼다.
 */
export function readMmi(text: string, names: MmiNames = KO_NAMES): ReadResult {
  const score = new Map<string, string>();
  const raws: RawTrack[] = [];
  const markers: Marker[] = [];
  const timeSig: TimeSigEvent[] = [];
  let section = "";
  let last: RawTrack | undefined;
  let lastKey = "";

  for (const line of text.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1]!;
      continue;
    }
    if (section === "mml-score") {
      // 들여쓴 줄은 바로 앞 mml-track 값의 이어지는 줄
      if (/^\s/.test(line) && lastKey === "mml-track" && last) {
        last.mml += line;
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      lastKey = key;
      if (key === "mml-track") {
        last = { mml: value, props: new Map() };
        raws.push(last);
      } else if (last) {
        last.props.set(key, value);
      } else {
        score.set(key, value);
      }
    } else if (section === "marker") {
      const m = /^(\d+)=(.*)$/.exec(line);
      if (m) markers.push({ id: `m${markers.length + 1}`, at: tickToRat(Number(m[1])), label: m[2]! });
    } else if (section === "time-signature") {
      const m = /^(\d+)=(\d+)\/(\d+)$/.exec(line);
      if (m) timeSig.push({ at: tickToRat(Number(m[1])), beats: Number(m[2]), unit: Number(m[3]) });
    }
  }

  const diagnostics: FileDiagnostic[] = [];
  const tempo: ChannelTempo[] = [];
  for (const item of (score.get("tempo") ?? "").split(",")) {
    const m = /^(\d+)T(\d+)$/.exec(item.trim());
    if (m) tempo.push({ at: tickToRat(Number(m[1])), bpm: Number(m[2]), channel: -1 });
  }

  const time = /^(\d+)\/(\d+)$/.exec(score.get("time") ?? "");
  if (time) timeSig.unshift({ at: ZERO, beats: Number(time[1]), unit: Number(time[2]) });

  const players: Player[] = [];
  const tracks: Track[] = [];
  const nextNoteId = idMaker("n");

  raws.forEach((raw, k) => {
    const body = raw.mml.replace(/^MML@/i, "").replace(/;\s*$/, "");
    const parts = body.split(",");
    const baseName = raw.props.get("name") || `Track${k + 1}`;
    const program = Number(raw.props.get("program") ?? 0) || 0;
    const songProgram = Number(raw.props.get("songProgram") ?? -1);
    const startDelta = Number(raw.props.get("startDelta") ?? 0) || 0;
    const startSongDelta = Number(raw.props.get("startSongDelta") ?? startDelta) || 0;
    // 편집기는 쓰지 않는 팬·보이기도 저장할 때 돌려주도록 트랙에 남긴다 (3MLE의 Panpot처럼).
    // 기본값(가운데 64·보이기)은 남기지 않는다: 소리 묶음을 가르는 열쇠(spread 등)에 mix가 들어가서, 새로 더한 트랙과 갈리지 않게
    const pan = Number(raw.props.get("panpot"));
    const mix = {
      ...(raw.props.get("panpot")?.trim() && Number.isInteger(pan) && pan >= 0 && pan <= 127 && pan !== 64 ? { pan } : {}),
      ...(raw.props.get("visible")?.trim().toLowerCase() === "false" ? { visible: false } : {}),
    };

    const player: Player = { id: `p${players.length + 1}`, name: baseName, instrument: instrumentFromProgram(program) };
    players.push(player);
    let songPlayer: Player | undefined;

    parts.forEach((partText, partIndex) => {
      if (partText.trim() === "") return;
      const isSong = partIndex === 3;
      let owner = player;
      if (isSong) {
        // 노래 파트는 다른 악기(목소리)라 연주자를 따로 둔다
        songPlayer ??= {
          id: `p${players.length + 1}`,
          name: names.songPlayer(baseName),
          instrument: instrumentFromProgram(songProgram >= 0 ? songProgram : program),
        };
        if (!players.includes(songPlayer)) players.push(songPlayer);
        owner = songPlayer;
      }
      const delta = isSong ? startSongDelta : startDelta;
      const track = channelToTrack(
        {
          name: `${baseName} ${names.parts[partIndex] ?? partIndex + 1}`,
          text: partText,
          player: owner,
          ...(delta ? { offset: tickToRat(delta) } : {}),
        },
        tracks.length,
        nextNoteId,
        tempo,
        diagnostics,
      );
      tracks.push({ ...track, ...(Object.keys(mix).length > 0 ? { mix } : {}), ...(isSong ? { mmiSong: true } : {}) });
    });
  });

  const base = emptySong({ title: score.get("title") ?? "", author: score.get("author") ?? "", profileId: "mobile" });
  const song: Song = {
    ...base,
    tempo: mergeTempo(tempo),
    timeSig: timeSig.sort((a, b) => cmp(a.at, b.at)),
    markers,
    players,
    tracks,
  };
  return { song, diagnostics };
}

/** mml-track 하나에 들어갈 트랙: 멜로디·화음1·화음2(최대 3)와 노래 칸. 노래 칸만 쓴 mml-track이면 parts가 비어 있다 */
interface MmiEntry {
  readonly name: string;
  /** 이 mml-track의 연주자. parts가 비어 있을 때 악기 번호를 여기서 읽는다 */
  readonly player: Player;
  readonly parts: readonly Track[];
  song?: Track;
}

/**
 * 곡 트랙을 mml-track으로 묶는다. 연주자마다 트랙을 3개씩 묶되, mml-track 하나는 악기·팬·보이기가 하나라
 * 그것이 바뀌는 자리에서도 나눈다. 노래 칸에서 읽은 트랙(mmiSong)은 노래 칸으로 돌려보낸다:
 * 노래 트랙만 있는 연주자(readMmi가 만든 '○○ 노래')면 바로 앞 연주자의 첫 mml-track에, 아니면 그 연주자의 첫 mml-track에.
 * 바로 앞 연주자에 트랙이 하나도 없으면(노래 칸만 쓴 mml-track을 읽은 곡) 멜로디·화음이 빈 mml-track을 만들어 노래 칸에 넣는다.
 * 노래 칸이 이미 찼거나 붙일 곳이 없는 노래 트랙은 보통 트랙처럼 쓴다 (더 앞의 다른 연주자 mml-track에는 붙이지 않는다)
 */
function mmiEntries(song: Song): MmiEntry[] {
  const entries: MmiEntry[] = [];
  const key = (t: Track) => `${trackInstrument(song, t).program ?? -1}|${t.mix?.pan ?? 64}|${t.mix?.visible ?? true}`;
  /** 바로 앞 연주자와 그 연주자의 첫 mml-track (트랙이 없으면 first 없음) */
  let prev: { player: Player; empty: boolean; first?: MmiEntry } | undefined;
  for (const player of song.players) {
    const own = song.tracks.filter((t) => t.playerId === player.id);
    const regular = own.filter((t) => !t.mmiSong);
    const songs = own.filter((t) => t.mmiSong);
    // 노래 트랙만 있는 연주자가 붙을 곳: 바로 앞 연주자의 첫 mml-track, 그 연주자에 트랙이 없으면 새 빈 mml-track
    let home: MmiEntry | undefined;
    if (regular.length === 0 && prev) {
      if (prev.first) home = prev.first.song ? undefined : prev.first;
      else if (prev.empty) home = { name: prev.player.name, player: prev.player, parts: [] };
    }
    const attach = songs.length > 0 && (regular.length > 0 || home) ? songs[0] : undefined;
    const groups: Track[][] = [];
    for (const track of [...regular, ...songs.filter((t) => t !== attach)]) {
      const last = groups.at(-1);
      if (last && last.length < 3 && key(last[0]!) === key(track)) last.push(track);
      else groups.push([track]);
    }
    const mine = groups.map((parts, g): MmiEntry => ({ name: groups.length > 1 ? `${player.name} ${g + 1}` : player.name, player, parts }));
    const target = regular.length > 0 ? mine[0] : home;
    if (attach && target) {
      target.song = attach;
      if (target === home && home.parts.length === 0) entries.push(home);
    }
    entries.push(...mine);
    prev = { player, empty: own.length === 0, ...(mine[0] ? { first: mine[0] } : {}) };
  }
  return entries;
}

/** 원문 글이 mml-track 칸에 그대로 들어갈 수 있는지: 칸 구분자(, ;)나 줄바꿈이 없고, 시작 자리가 96칸 격자 위 */
function fitsMmi(track: Track): track is Track & { readonly mml: NonNullable<Track["mml"]> } {
  return !!track.mml && !/[,;\r\n]/.test(track.mml.text) && ratToTick(track.mml.offset ?? ZERO).exact;
}

/**
 * 모든 트랙에 사용자가 쓴 원문이 있고, 한 mml-track의 멜로디·화음 칸이 같은 시작 자리(startDelta)를 쓰고,
 * 원문 속 템포를 모으면 곡 템포 지도와 같으면(들리는 템포로 비교) 트랙 id마다 원문을 준다 (3MLE의 verbatimTexts처럼).
 * 원문에 템포가 하나도 없으면(tempo= 줄에만 적힌 곡) 첫 파트 원문의 음 경계에 곡 템포를 끼워 본다.
 * 이때는 다시 출력하지 않고 원문을 그대로 저장해서 쓴 사람의 표기(l·o·v 습관, 주석)를 지킨다.
 * 하나라도 아니면 undefined (출력기로 새로 쓴다).
 */
function mmiVerbatim(song: Song, entries: readonly MmiEntry[]): Map<string, string> | undefined {
  const texts = new Map<string, string>();
  const tempo: TempoEvent[] = [];
  for (const entry of entries) {
    for (const track of entry.song ? [...entry.parts, entry.song] : entry.parts) {
      if (!fitsMmi(track)) return undefined;
      texts.set(track.id, track.mml.text);
      tempo.push(...tempoTokens(track.mml));
    }
    const start = entry.parts[0]?.mml?.offset ?? ZERO;
    if (entry.parts.some((t) => cmp(t.mml?.offset ?? ZERO, start) !== 0)) return undefined;
  }
  const want = audibleTempo(song.tempo);
  if (sameTempo(audibleTempo(tempo), want)) return texts;
  if (tempo.length > 0) return undefined;
  // 출력기와 같이 곡 템포는 첫 파트(노래 칸만 쓴 mml-track이면 노래 칸)에 넣는다. 음 가운데라 끼울 자리가 없으면 출력기로
  const first = entries[0]?.parts[0] ?? entries[0]?.song;
  if (!first?.mml) return undefined;
  const source = surgicalSource(first.mml);
  if (!source) return undefined;
  const edits: { span: [number, number]; text: string }[] = [];
  for (const e of want) {
    const local = localAt(first.mml, e.at);
    const at = local && tempoInsertOffset(first.mml.text, source.parsed, local);
    if (at === undefined) return undefined;
    edits.push({ span: [at, at], text: `t${e.bpm}` });
  }
  const text = spliceText(first.mml.text, edits);
  if (!sameTempo(audibleTempo(tempoTokens({ ...first.mml, text })), want)) return undefined;
  texts.set(first.id, text);
  return texts;
}

/**
 * 곡을 .mmi 문자열로 쓴다. 연주자마다 트랙을 3개씩 묶어 멜로디·화음1·화음2에 넣고, 노래 칸에서 읽은 트랙은 노래 칸에 넣는다.
 * 연주자 트랙이 3개를 넘으면 mml-track을 더 만든다.
 * 모든 트랙에 원문이 있으면 원문을 그대로 쓰고(startDelta도 원문 시작 자리로), 아니면 출력기로 새로 쓴다.
 * 템포는 tempo= 줄과 첫 파트 본문에 같이 쓴다.
 */
export function writeMmi(song: Song): { text: string; diagnostics: FileDiagnostic[] } {
  const diagnostics: FileDiagnostic[] = [];
  const tempoItems: string[] = [];
  for (const t of song.tempo) {
    const { tick, exact } = ratToTick(t.at);
    if (!exact) {
      diagnostics.push({
        level: "warning",
        code: "tick-rounded",
        params: { bpm: t.bpm },
        span: [0, 0],
        where: "tempo",
      });
    }
    // 음수 startDelta 트랙 맨 앞의 템포(곡 처음보다 앞)는 tempo= 줄에서 곡 처음(0)으로 적는다. 음수 tick은 읽지 못한다
    const item = `${Math.max(0, tick)}T${t.bpm}`;
    if (tick <= 0 && tempoItems.length > 0 && tempoItems.at(-1)!.startsWith("0T")) tempoItems[tempoItems.length - 1] = item;
    else tempoItems.push(item);
  }
  const sig = song.timeSig[0];
  const lines = [
    "[mml-score]",
    "version=1",
    `title=${song.meta.title}`,
    `author=${song.meta.author}`,
    `time=${sig?.beats ?? 4}/${sig?.unit ?? 4}`,
    `tempo=${tempoItems.join(",")}`,
  ];

  /** 저장할 악기 번호. 모바일 전용 악기(포크 기타 등)는 번호가 정해지지 않아 악보 악기 번호로 쓰고 알린다 */
  const programOf = (track: Track) => {
    const inst = trackInstrument(song, track);
    if (inst.program !== undefined) return inst.program;
    const fallback = song.players.find((p) => p.id === track.playerId)?.instrument.program ?? 0;
    diagnostics.push({ level: "warning", code: "instrument-no-program", params: { instrument: inst.canonical, program: fallback }, span: [0, 0], where: track.name });
    return fallback;
  };
  const playerProgram = (entry: MmiEntry) => {
    const inst = entry.player.instrument;
    if (inst.program !== undefined) return inst.program;
    diagnostics.push({ level: "warning", code: "instrument-no-program", params: { instrument: inst.canonical, program: 0 }, span: [0, 0], where: entry.name });
    return 0;
  };
  const entries = mmiEntries(song);
  const verbatim = mmiVerbatim(song, entries);

  let tempoWritten = false;
  /** 출력기로 새로 쓴 칸 글. 곡 시작보다 앞선 음은 lead만큼 뒤로 민 다음 startDelta로 당긴다 */
  const print = (track: Track, lead: Rat) => {
    const shift = (at: Rat) => sub(at, lead);
    const notes = lead === ZERO ? track.notes : track.notes.map((n) => ({ ...n, start: shift(n.start) }));
    const tempo = tempoWritten ? [] : lead === ZERO ? song.tempo : song.tempo.map((t) => ({ ...t, at: shift(t.at) }));
    const printed = optimizeMml(notes, { tempo });
    tempoWritten = true;
    for (const d of printed.diagnostics) diagnostics.push({ ...d, where: track.name });
    return printed.text;
  };
  /** 곡 시작보다 앞선 음(읽을 때 음수 startDelta로 당겨진 음)이 있으면 그 자리. 출력기는 음수 위치의 음을 쓸 수 없다 */
  const leadOf = (tracks: readonly Track[]) => {
    const earliest = tracks.flatMap((t) => t.notes.map((n) => n.start)).reduce<Rat>((a, b) => (cmp(a, b) <= 0 ? a : b), ZERO);
    return cmp(earliest, ZERO) < 0 ? earliest : ZERO;
  };

  for (const entry of entries) {
    for (const track of entry.song ? [...entry.parts, entry.song] : entry.parts) {
      // 4분음표 96칸 격자 밖의 음(9·7분음표 등). 마비꼬 1.5.12에서 이런 파일도 열리는 것은 확인했고, 위치는 격자로 맞춰질 수 있다
      // (원문을 그대로 써도 마비꼬가 격자로 맞추므로 알린다)
      const offGrid = track.notes.filter((n) => !ratToTick(n.start).exact || !ratToTick(n.dur).exact).length;
      if (offGrid > 0) {
        diagnostics.push({
          level: "warning",
          code: "mmi-off-grid",
          params: { count: offGrid },
          span: [0, 0],
          where: track.name,
        });
      }
    }
    const texts: string[] = [];
    let start: Rat;
    let songStart: Rat = ZERO;
    let songText: string | undefined;
    if (verbatim) {
      // 이어지는 줄로 읽은 칸 앞뒤 빈칸만 떼고 원문 그대로
      for (const track of entry.parts) texts.push(verbatim.get(track.id)!.trim());
      start = entry.parts[0]?.mml?.offset ?? ZERO;
      if (entry.song) {
        songText = verbatim.get(entry.song.id)!.trim();
        songStart = entry.song.mml?.offset ?? ZERO;
      }
    } else {
      start = leadOf(entry.parts);
      for (const track of entry.parts) texts.push(print(track, start));
      if (entry.song) {
        songStart = leadOf([entry.song]);
        songText = print(entry.song, songStart);
      }
    }
    while (texts.length < 3) texts.push("");
    if (songText !== undefined) texts.push(songText);
    // 노래 칸만 쓴 mml-track은 연주자 악기 번호로 (번호가 없는 모바일 전용 악기는 0으로 쓰고 알린다)
    const program = entry.parts[0] ? programOf(entry.parts[0]) : playerProgram(entry);
    // 노래 악기가 연주 악기와 같으면 -1 (readMmi는 -1을 연주 악기로 읽는다)
    const songProgram = entry.song ? programOf(entry.song) : -1;
    // 팬·보이기는 첫 파트에서 (노래 칸만 쓴 mml-track이면 노래 트랙에서. readMmi는 같은 값을 둘 다에 담는다)
    const head = entry.parts[0] ?? entry.song!;
    const delta = ratToTick(start).tick;
    // startSongDelta가 없으면 노래 칸도 startDelta를 쓴다
    const songDelta = entry.song ? ratToTick(songStart).tick : delta;
    lines.push(
      `mml-track=MML@${texts.join(",")};`,
      `name=${entry.name}`,
      `program=${program}`,
      `songProgram=${songProgram === program ? -1 : songProgram}`,
      ...(delta === 0 ? [] : [`startDelta=${delta}`]),
      ...(songDelta === delta ? [] : [`startSongDelta=${songDelta}`]),
      `panpot=${head.mix?.pan ?? 64}`,
      `visible=${head.mix?.visible === false ? "false" : "true"}`,
    );
  }

  // 첫 박자는 time=에, 곡 중간 박자 변화는 [time-signature]에
  if (song.timeSig.length > 1) {
    lines.push("[time-signature]");
    for (const t of song.timeSig.slice(1)) lines.push(`${ratToTick(t.at).tick}=${t.beats}/${t.unit}`);
  }
  if (song.markers.length > 0) {
    lines.push("[marker]");
    for (const m of song.markers) lines.push(`${ratToTick(m.at).tick}=${m.label}`);
  }
  return { text: lines.join("\n") + "\n", diagnostics };
}
