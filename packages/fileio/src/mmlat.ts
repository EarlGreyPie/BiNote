import { add, cmp, DEFAULT_BPM, emptySong, INSTRUMENTS, rat, ZERO, type InstrumentRef, type Note, type Player, type Rat, type Song, type Track } from "@mmlce/core";
import { padTrackEnd, scoreEnd } from "@mmlce/mml";
import { channelToTrack, idMaker, mergeTempo, trackColor, type ChannelTempo, type FileDiagnostic } from "./common.js";
import type { ReadResult } from "./threemle.js";

/**
 * 게임에 붙여넣는 글 "MML@트랙1,트랙2,...;" (PC 마비노기와 같은 형식)을 읽는다.
 * 글 안에 MML@ 악보가 여러 개 있으면 각각을 연주자 한 명으로 본다(같이 연주하는 합주).
 * 마지막 ; 가 없어도 글 끝까지를 악보로 읽는다.
 */
export function findMmlAt(text: string): string[][] {
  return findMmlAtBlocks(text).map((b) => b.parts);
}

/** 악기 이름 하나와 그 악기. 머리줄에서 이 이름을 찾으면 그 악기를 미리 고른다 */
export interface InstrumentName {
  readonly name: string;
  readonly instrument: InstrumentRef;
}

/** 글 안의 MML@ 악보 하나와 그 바로 앞 줄(머리줄)에서 읽은 것 */
export interface MmlAtBlock {
  /** 트랙 글 (콤마로 나눈 것) */
  readonly parts: string[];
  /** 머리줄: 앞 악보와 이 MML@ 사이에서 가장 가까운 비어 있지 않은 줄 (같은 줄의 MML@ 앞 글 포함). 없으면 "" */
  readonly header: string;
  /** 머리줄에서 권 표기('악보 N'·'N권'·'Vol. N' 등)와 꾸밈 기호를 뺀 이름 */
  readonly label: string;
  /** 머리줄에 적힌 권 번호 */
  readonly volume?: number;
  /** 머리줄에 적힌 악기 (받은 이름 가운데 들어 있는 가장 긴 것) */
  readonly instrument?: InstrumentRef;
}

/**
 * 권 번호 표기 (5개 언어). 커뮤니티 글에서 흔한 꼴만 읽는다.
 * BiNote 악보책 복사 글에는 머리줄이 없으므로 이것은 사람이 여러 권을 모아 쓴 글용이다
 */
const VOLUME_PATTERNS: readonly RegExp[] = [
  /(?:제\s*)?(\d{1,3})\s*권/,
  /악보\s*(\d{1,3})/,
  /(?:第\s*)?(\d{1,3})\s*(?:[巻卷冊册]目?|份)/,
  /(?:楽譜|樂譜|乐谱)\s*(\d{1,3})/,
  /\b(?:book|vol(?:ume)?\.?|score)\s*#?\s*(\d{1,3})\b/i,
  /\(\s*(\d{1,3})\s*\/\s*\d{1,3}\s*\)/,
];

/** 이 길이보다 긴 머리줄 이름은 곡 소개 글일 때가 많아 연주자 이름으로 쓰지 않는다 */
const NAME_MAX = 24;

/** 머리줄에서 권 번호를 읽고, 그 표기를 뺀 나머지를 준다 */
function readVolume(header: string): { volume?: number; rest: string } {
  for (const pattern of VOLUME_PATTERNS) {
    const m = pattern.exec(header);
    if (m) return { volume: Number(m[1]), rest: `${header.slice(0, m.index)} ${header.slice(m.index + m[0].length)}` };
  }
  return { rest: header };
}

/** 이름 앞뒤의 꾸밈(괄호·콜론·줄표·# 같은 기호)을 걷어 낸다 */
function cleanLabel(text: string): string {
  return text
    .replace(/[[\]()<>{}【】「」『』:：\-–—=*#|·,.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 머리줄에 들어 있는 가장 긴 악기 이름의 악기 (대소문자 무시. 'Flute' 안의 'lute'보다 'flute'가 이긴다) */
function readInstrument(header: string, names: readonly InstrumentName[]): InstrumentRef | undefined {
  const lower = header.toLowerCase();
  let best: InstrumentName | undefined;
  for (const n of names) {
    if (n.name === "" || !lower.includes(n.name.toLowerCase())) continue;
    if (!best || n.name.length > best.name.length) best = n;
  }
  return best?.instrument;
}

/** 글 안의 MML@ 악보를 머리줄과 함께 글 순서대로 찾는다 */
export function findMmlAtBlocks(text: string, names: readonly InstrumentName[] = []): MmlAtBlock[] {
  const blocks: MmlAtBlock[] = [];
  let from = 0;
  for (const m of text.matchAll(/MML@([^;]*)(;|$)/gi)) {
    // 앞 악보 끝부터 이 MML@까지에서 가장 가까운 줄 하나만 머리줄로 본다 (그 위 글은 곡 소개일 때가 많다)
    const before = text.slice(from, m.index).split(/\r?\n/);
    from = m.index + m[0].length;
    const header = before.reverse().find((line) => line.trim() !== "")?.trim() ?? "";
    const { volume, rest } = readVolume(header);
    const instrument = readInstrument(header, names);
    blocks.push({
      parts: m[1]!.split(",").map((t) => t.trim()),
      header,
      label: cleanLabel(rest),
      ...(volume !== undefined ? { volume } : {}),
      ...(instrument ? { instrument } : {}),
    });
  }
  return blocks;
}

export interface MmlAtOptions {
  /** 연주자 악기. 글에는 악기 정보가 없으므로 고른 악기를 쓴다 (기본 피아노). 머리줄에서 악기를 읽으면 그것이 먼저다 */
  readonly instrument?: InstrumentRef;
  /** 연주자 이름 앞부분 (기본 "연주자"). 머리줄에 짧은 이름이 있으면 그것을 쓴다 */
  readonly playerName?: string;
  /**
   * 악보 여러 개를 어떻게 볼지. "players" = 악보마다 연주자 한 명 (같이 연주, 기본),
   * "book" = 연주자마다 악보책의 권들로 보고 차례로 잇는다
   */
  readonly mode?: "players" | "book";
  /** 권으로 이을 때 권 사이 틈(ms, 프로필의 scoreBookGapMs). 없거나 null이면 틈 없이 잇는다 */
  readonly gapMs?: number | null;
  /** 머리줄에서 찾을 악기 이름 (5개 언어 이름은 화면 쪽에서 모아 준다) */
  readonly instrumentNames?: readonly InstrumentName[];
}

export interface MmlAtRead extends ReadResult {
  /** 글에서 찾은 악보 (글 순서) */
  readonly blocks: readonly MmlAtBlock[];
  /** 연주자마다 쓴 악보 차례(blocks의 번호). 권으로 이었으면 이은 순서대로 */
  readonly playerBlocks: Readonly<Record<string, readonly number[]>>;
}

/**
 * 권으로 이을 때 악보를 연주자별로 묶는다. 권 표기를 뺀 머리줄 이름이 같으면 같은 연주자이고,
 * 머리줄 없이 바로 이어 붙은 악보는 앞 악보와 같은 연주자다.
 * 같은 이름에 같은 권 번호가 또 나오면 다른 연주자로 본다 (같은 악기를 두 명이 칠 때 등).
 * 권 번호가 모두 적힌 연주자는 번호 순으로, 아니면 글 순서대로 잇는다
 */
function groupVolumes(blocks: readonly MmlAtBlock[]): number[][] {
  const groups: { label: string; blocks: number[]; seen: Set<number> }[] = [];
  let previous: (typeof groups)[number] | undefined;
  blocks.forEach((b, k) => {
    const same = groups.filter((g) => g.label === b.label);
    const home =
      b.header === "" && previous ? previous : b.volume === undefined ? same[0] : same.find((g) => !g.seen.has(b.volume!));
    previous = home ?? { label: b.label, blocks: [], seen: new Set() };
    if (!home) groups.push(previous);
    previous.blocks.push(k);
    if (b.volume !== undefined) previous.seen.add(b.volume);
  });
  return groups.map((g) => {
    if (g.blocks.some((k) => blocks[k]!.volume === undefined)) return g.blocks;
    return [...g.blocks].sort((a, b) => blocks[a]!.volume! - blocks[b]!.volume!);
  });
}

/** 권 사이 틈을 그 자리 빠르기로 온음표 길이로 (악보책 나누기가 권 끝을 앞당기는 것과 같은 64분음표 단위) */
function gapLength(gapMs: number | null | undefined, bpm: number): Rat {
  if (!gapMs) return ZERO;
  return rat(Math.round(((gapMs / 1000) * bpm * 64) / 240), 64);
}

export function readMmlAt(text: string, options: MmlAtOptions = {}): MmlAtRead {
  const piano = INSTRUMENTS.find((i) => i.id === "piano")!;
  const instrument: InstrumentRef = options.instrument ?? { canonical: piano.id, program: piano.program! };
  const prefix = options.playerName ?? "연주자";
  const diagnostics: FileDiagnostic[] = [];
  const players: Player[] = [];
  const tracks: Track[] = [];
  const tempo: ChannelTempo[] = [];
  /** 권으로 이은 트랙과 마지막 권이 끝나는 자리 (끝 쉼표 포함) */
  const bookEnds: { trackIds: string[]; end: Rat }[] = [];
  const nextNoteId = idMaker("n");
  const playerBlocks: Record<string, number[]> = {};

  const blocks = findMmlAtBlocks(text, options.instrumentNames);
  if (blocks.length === 0) diagnostics.push({ level: "error", code: "mmlat-not-found", span: [0, 0], where: "" });
  const groups = options.mode === "book" ? groupVolumes(blocks) : blocks.map((_, k) => [k]);
  groups.forEach((group, k) => {
    const first = blocks[group[0]!]!;
    const player: Player = {
      id: `p${k + 1}`,
      name: first.label !== "" && first.label.length <= NAME_MAX ? first.label : `${prefix} ${k + 1}`,
      instrument: group.map((b) => blocks[b]!.instrument).find((i) => i !== undefined) ?? instrument,
    };
    players.push(player);
    playerBlocks[player.id] = group;
    if (group.length === 1) {
      first.parts.forEach((part, i) => {
        tracks.push(channelToTrack({ name: `${player.name}-${i + 1}`, text: part, player }, tracks.length, nextNoteId, tempo, diagnostics));
      });
      return;
    }
    // 권 잇기: 다음 권은 앞 권 길이(가장 긴 채널, 끝 쉼표는 게임처럼 뺀다) + 권 사이 틈 자리에서 시작한다.
    // 권마다 트랙 글이 따로라 원문 하나로 남길 수 없으므로, 이은 트랙은 원문 없이 음만 갖는다 (화면 글은 출력기가 쓴다)
    const base = tracks.length;
    const channels: Note[][] = [];
    let offset: Rat = ZERO;
    let last: Rat = ZERO;
    let bpm = DEFAULT_BPM;
    group.forEach((b, v) => {
      let own: ChannelTempo[] = [];
      const parts = blocks[b]!.parts.map((part, i) =>
        channelToTrack({ name: `${player.name}-${i + 1} [${v + 1}]`, text: part, player, offset }, base + i, nextNoteId, own, diagnostics),
      );
      parts.forEach((p, i) => (channels[i] ??= []).push(...p.notes));
      // 게임은 권마다 빠르기를 기본값(t120)부터 읽으므로, 첫머리에 t가 없는 권은 그 자리에 기본 빠르기를 둔다
      if (v > 0 && !own.some((e) => cmp(e.at, offset) === 0)) own.push({ at: offset, bpm: DEFAULT_BPM, channel: base });
      // 앞 권 끝 빠르기를 권 첫머리에 다시 적은 t는 소리를 바꾸지 않으므로 지도에 넣지 않는다
      if (v > 0) own = own.filter((e) => cmp(e.at, offset) !== 0 || e.bpm !== bpm);
      const length = scoreEnd(parts);
      const end = cmp(length, offset) > 0 ? length : offset;
      const before = bpm;
      const bpmAt = (events: readonly ChannelTempo[]) =>
        events.filter((e) => cmp(e.at, end) <= 0).sort((x, y) => cmp(x.at, y.at)).at(-1)?.bpm ?? (v > 0 ? before : DEFAULT_BPM);
      bpm = bpmAt(own);
      const gap = gapLength(options.gapMs, bpm);
      // 틈이 없으면 권 끝 자리의 t(끝 쉼표를 지키려고 붙인 t 등)가 다음 권 첫머리와 같은 자리에 놓여 다음 권 빠르기를 덮는다.
      // 그 t는 이 권 소리를 바꾸지 않으므로 다음 권이 있으면 뺀다
      if (cmp(gap, ZERO) === 0 && v < group.length - 1) {
        own = own.filter((e) => cmp(e.at, end) < 0);
        bpm = bpmAt(own);
      }
      tempo.push(...own);
      last = end;
      offset = add(end, gap);
    });
    // 마지막 권의 끝 쉼표(게임 길이에 드는 것)는 이은 트랙에 원문이 없어 사라지므로, 곡을 다 만든 뒤 글로 붙인다
    bookEnds.push({ trackIds: channels.map((_, i) => `t${base + i + 1}`), end: last });
    channels.forEach((notes, i) => {
      tracks.push({
        id: `t${base + i + 1}`,
        playerId: player.id,
        name: `${player.name}-${i + 1}`,
        color: trackColor(base + i),
        role: "free",
        mute: false,
        solo: false,
        notes,
        spelling: {},
      });
    });
  });

  let song: Song = {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: mergeTempo(tempo),
    players,
    tracks,
  };
  for (const { trackIds, end } of bookEnds) {
    // 음이 가장 늦게 끝나는 트랙 하나에 붙인다 (악보 길이는 가장 긴 채널이 정하므로 하나면 된다)
    const joined = song.tracks.filter((t) => trackIds.includes(t.id));
    const longest = joined.reduce<Track | undefined>((best, t) => (!best || cmp(lastEnd(t), lastEnd(best)) > 0 ? t : best), undefined);
    if (longest && cmp(end, scoreEnd(joined)) > 0) song = padTrackEnd(song, longest.id, end);
  }
  return { song, diagnostics, blocks, playerBlocks };
}

/** 트랙의 마지막 음이 끝나는 자리 (음이 없으면 0) */
function lastEnd(track: Track): Rat {
  return track.notes.reduce<Rat>((end, n) => {
    const e = add(n.start, n.dur);
    return cmp(e, end) > 0 ? e : end;
  }, ZERO);
}

/** 3MLE·마비꼬 파일이 아니고 MML@ 악보가 들어 있는 글인지 */
export function looksLikeMmlAt(text: string): boolean {
  return !/^\s*\[[^\]]+\]\s*$/m.test(text) && /MML@/i.test(text);
}
