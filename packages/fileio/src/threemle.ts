import { emptySong, getProfile, PROFILES, trackInstrument, ZERO, type Player, type Song, type TempoEvent, type Track } from "@mmlce/core";
import { bpmBefore, optimizeMml, padScore, placeTempoByScore, scoreEnd, scoreTrackIds, songChordsPerScore, type TempoMove } from "@mmlce/mml";
import { encodeCp949 } from "./cp949.js";
import { channelToTrack, idMaker, instrumentFromProgram, mergeTempo, type ChannelTempo, verbatimTexts, type FileDiagnostic } from "./common.js";

/**
 * 3MLE .mml 파일. 공개된 파일 구조만 보고 독자 구현한다.
 *
 * [Settings]           Title, Source, Memo, TimeBase, TimeSignatureNN/DD, Encoding
 * [ChannelPropertyN]   Name, Patch, Volume, Panpot, Marker
 * [ChannelN]           MML 본문 (여러 줄, /* *\/ 주석 가능)
 */

interface Section {
  readonly name: string;
  readonly lines: string[];
}

function sections(text: string): Section[] {
  const out: Section[] = [];
  let current: Section | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]\s*$/.exec(raw);
    if (header) {
      current = { name: header[1]!, lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(raw);
    }
  }
  return out;
}

function keyValues(lines: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq > 0) map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return map;
}

export interface ReadResult {
  readonly song: Song;
  readonly diagnostics: FileDiagnostic[];
}

/**
 * 3MLE 파일을 곡으로 읽는다. 채널 하나가 트랙 하나가 되고,
 * 3MLE에는 연주자 개념이 없으므로 같은 악기(Patch)의 채널을 한 연주자로 묶는다.
 */
export interface Read3mleOptions {
  /** 악보 하나에 담을 화음(트랙) 수. 기본 6 (모바일 프로필) */
  readonly chordsPerScore?: number;
  /** 악보(연주자) 이름. 앱이 화면 언어로 넘긴다 (기본 "악보 n") */
  readonly scoreName?: (n: number) => string;
}

export function read3mle(text: string, options: Read3mleOptions = {}): ReadResult {
  const secs = sections(text);
  const settings = keyValues(secs.find((s) => s.name === "Settings")?.lines ?? []);
  const props = new Map<number, Map<string, string>>();
  const bodies = new Map<number, string>();
  for (const s of secs) {
    const prop = /^ChannelProperty(\d+)$/.exec(s.name);
    const chan = /^Channel(\d+)$/.exec(s.name);
    if (prop) props.set(Number(prop[1]), keyValues(s.lines));
    // 구역 사이 빈 줄은 본문이 아니다
    else if (chan) bodies.set(Number(chan[1]), s.lines.join("\n").replace(/\s+$/, ""));
  }

  const diagnostics: FileDiagnostic[] = [];
  const players: Player[] = [];
  const tracks: Track[] = [];
  const tempo: ChannelTempo[] = [];
  const nextNoteId = idMaker("n");

  // 채널 순서대로 화음 수(기본 6)씩 끊어 악보 하나로 묶는다. 게임은 악보 하나에 연주자 여럿이 들어가고
  // 연주자마다 악기가 따로라, 악기(Patch)가 다른 채널도 같은 악보 안 트랙 악기로 둔다
  const perScore = Math.max(1, options.chordsPerScore ?? 6);
  const channels = [...bodies.keys()].sort((a, b) => a - b);
  channels.forEach((num, index) => {
    const p = props.get(num);
    const patch = Number(p?.get("Patch") ?? 0) || 0;
    const instrument = instrumentFromProgram(patch);
    if (index % perScore === 0) players.push({ id: `p${players.length + 1}`, name: (options.scoreName ?? ((n) => `악보 ${n}`))(players.length + 1), instrument });
    const player = players[players.length - 1]!;
    const name = p?.get("Name") || `Channel${num}`;
    const read = channelToTrack({ name, text: bodies.get(num)!, player }, index, nextNoteId, tempo, diagnostics);
    const track = instrument.canonical === player.instrument.canonical && instrument.program === player.instrument.program ? read : { ...read, instrument };
    // 편집기가 쓰지 않는 채널 볼륨·팬도 저장할 때 돌려주도록 남긴다
    const volume = Number(p?.get("Volume"));
    const pan = Number(p?.get("Panpot"));
    const mix = {
      ...(p?.has("Volume") && Number.isFinite(volume) ? { volume } : {}),
      ...(p?.has("Panpot") && Number.isFinite(pan) ? { pan } : {}),
    };
    tracks.push(Object.keys(mix).length > 0 ? { ...track, mix } : track);
  });

  const nn = Number(settings.get("TimeSignatureNN"));
  const dd = Number(settings.get("TimeSignatureDD"));
  const memo = settings.get("Memo");
  const base = emptySong({ title: settings.get("Title") ?? "", author: settings.get("Source") ?? "", profileId: "mobile", ...(memo ? { memo } : {}) });
  const song: Song = {
    ...base,
    tempo: mergeTempo(tempo),
    timeSig: nn > 0 && dd > 0 ? [{ at: ZERO, beats: nn, unit: dd }] : [],
    players,
    tracks,
  };
  return { song, diagnostics };
}

export type ThreeMleEncoding = "cp949" | "utf-8";

export interface Write3mleOptions {
  /** 파일 머리의 Encoding 표기. 기본 cp949(3MLE 기본) */
  readonly encoding?: ThreeMleEncoding;
  /** 곡 템포를 모두 이 트랙에 쓴다. 없으면 악보(연주자)마다 템포마다 음을 쪼개지 않는 채널을 골라 넣는다 (게임은 악보마다 템포를 읽는다) */
  readonly tempoTrackId?: string;
}

/** 악보마다 곡 템포를 모두 넣을 자리, 곡 트랙 순서대로. 악보는 곡 프로필의 악기별 화음 수로 묶는다 (게임에 넣을 글과 같다) */
function tempoByTrack(song: Song): { placed: TempoEvent[][]; moved: number } {
  const moved = new Map<string, TempoMove[]>();
  const byScore = placeTempoByScore(song, songChordsPerScore(song), moved);
  return { placed: song.tracks.map((t) => byScore.get(t.id) ?? []), moved: [...moved.values()].reduce((sum, list) => sum + list.length, 0) };
}

/** 곡을 3MLE 파일 문자열로 쓴다. 바이트로 바꿀 때는 encode3mle를 쓴다. */
export function write3mle(song: Song, options: Write3mleOptions = {}): { text: string; diagnostics: FileDiagnostic[] } {
  const diagnostics: FileDiagnostic[] = [];
  const verbatim = options.tempoTrackId ? undefined : verbatimTexts(song);
  const byScore = verbatim || options.tempoTrackId ? undefined : tempoByTrack(song);
  const placed = verbatim
    ? []
    : options.tempoTrackId
    ? song.tracks.map((t) => (t.id === options.tempoTrackId ? [...song.tempo] : []))
    : byScore!.placed;
  if (byScore && byScore.moved > 0) diagnostics.push({ level: "warning", code: "tempo-moved", params: { count: byScore.moved }, span: [0, 0], where: "" });
  const sig = song.timeSig[0];
  const lines = [
    "[Settings]",
    `Encoding=${(options.encoding ?? "cp949") === "cp949" ? "ks_c_5601-1987" : "utf-8"}`,
    `Title=${song.meta.title}`,
    `Source=${song.meta.author}`,
    `Memo=${song.meta.memo ?? ""}`,
    "TimeBase=960",
    `TimeSignatureNN=${sig?.beats ?? 4}`,
    `TimeSignatureDD=${sig?.unit ?? 4}`,
  ];
  /** 저장할 악기 번호. 모바일 전용 악기(포크 기타 등)는 번호가 정해지지 않아 악보 악기 번호로 쓰고 알린다 */
  const patchOf = (track: (typeof song.tracks)[number]) => {
    const inst = trackInstrument(song, track);
    if (inst.program !== undefined) return inst.program;
    const fallback = song.players.find((p) => p.id === track.playerId)?.instrument.program ?? 0;
    diagnostics.push({ level: "warning", code: "instrument-no-program", params: { instrument: inst.canonical, program: fallback }, span: [0, 0], where: track.name });
    return fallback;
  };
  const bodies = song.tracks.map((track, index) => {
    const body = verbatim?.[index]?.replace(/\r?\n/g, "\r\n");
    if (body !== undefined) return body;
    const printed = optimizeMml(track.notes, { tempo: placed[index] ?? [] });
    for (const d of printed.diagnostics) diagnostics.push({ ...d, where: track.name });
    return printed.text;
  });
  // 출력기로 다시 쓴 글은 원문 끝 쉼표가 사라지므로, 악보마다 원래 길이까지 채운다 (게임에 넣을 글과 같게)
  if (!verbatim) {
    for (const ids of scoreTrackIds(song, songChordsPerScore(song))) {
      const ks = ids.map((id) => song.tracks.findIndex((t) => t.id === id)).filter((k) => k >= 0);
      const end = scoreEnd(ks.map((k) => song.tracks[k]!));
      const profile = PROFILES[song.meta.profileId] ?? getProfile("mobile");
      const padded = padScore(ks.map((k) => bodies[k]!), end, bpmBefore(song.tempo, end), profile.length, undefined, profile.charLimitPerScore);
      ks.forEach((k, j) => (bodies[k] = padded[j]!));
    }
  }
  song.tracks.forEach((track, index) => {
    const body = bodies[index]!;
    const n = index + 1;
    lines.push(
      "",
      `[ChannelProperty${n}]`,
      `Name=${track.name}`,
      `Patch=${patchOf(track)}`,
      `Volume=${track.mix?.volume ?? 100}`,
      `Panpot=${track.mix?.pan ?? 64}`,
      "Marker=0",
      "",
      `[Channel${n}]`,
      body,
    );
  });
  return { text: lines.join("\r\n") + "\r\n", diagnostics };
}

export interface Encode3mleResult {
  readonly encoding: ThreeMleEncoding;
  readonly bytes: Uint8Array;
  readonly diagnostics: FileDiagnostic[];
  /** cp949로 쓸 수 없는 글자. 비어 있지 않으면 화면에서 UTF-8 저장을 권한다 */
  readonly unencodable: string[];
}

/**
 * 곡을 3MLE 파일 바이트로. 기본은 CP949이고, CP949에 없는 글자(일부 한자·번체 등)가 있으면
 * `?`로 바꾼 결과와 함께 경고를 낸다. 사용자가 고르면 encoding: "utf-8"로 다시 부른다.
 */
export function encode3mle(song: Song, options: Write3mleOptions = {}): Encode3mleResult {
  const encoding = options.encoding ?? "cp949";
  const { text, diagnostics } = write3mle(song, { ...options, encoding });
  if (encoding === "utf-8") {
    return { encoding, bytes: new TextEncoder().encode(text), diagnostics, unencodable: [] };
  }
  const { bytes, unencodable } = encodeCp949(text);
  if (unencodable.length > 0) {
    diagnostics.push({
      level: "warning",
      code: "cp949-unencodable",
      params: { chars: unencodable.join(" ") },
      span: [0, 0],
      where: "file",
    });
  }
  return { encoding, bytes, diagnostics, unencodable };
}
