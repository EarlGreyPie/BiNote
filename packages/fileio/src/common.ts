import { add, cmp, instrumentByProgram, normalizeTempo, type Note, type Song, type Player, type Rat, type TempoEvent, type Track } from "@mmlce/core";
import { audibleTempo, parseMml, sameTempo, scoresMissingTempo, type Diagnostic, type ParseOptions } from "@mmlce/mml";

/** 파일을 읽다 생긴 문제. 어느 채널(트랙)에서 났는지 함께 남긴다 */
export interface FileDiagnostic extends Diagnostic {
  readonly where: string;
}

export function idMaker(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const TRACK_COLORS = ["#4f8cff", "#ff7a59", "#2bb673", "#b061ff", "#f2b705", "#00b8d9"];

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length]!;
}

/**
 * 파일의 악기 번호를 공통 ID로. PC 마비노기와 같은 번호로 알려진 악기만 이름을 붙이고,
 * 모르는 번호는 `mabi:번호`로 남겨 재생할 때 사운드팩의 같은 번호를 쓴다.
 */
export function instrumentFromProgram(program: number) {
  return { canonical: instrumentByProgram(program)?.id ?? `mabi:${program}`, program };
}

export interface ChannelInput {
  readonly name: string;
  readonly text: string;
  readonly player: Player;
  readonly offset?: Rat;
  readonly parse?: ParseOptions;
}

/** 파일에서 읽은 템포와 그 템포를 적은 채널 */
export interface ChannelTempo extends TempoEvent {
  readonly channel: number;
}

/** MML 채널 하나를 트랙으로. 채널 안의 템포는 곡 템포 지도로 모은다 */
export function channelToTrack(
  input: ChannelInput,
  index: number,
  nextNoteId: () => string,
  tempoOut: ChannelTempo[],
  diagnostics: FileDiagnostic[],
): Track {
  const parsed = parseMml(input.text, input.parse);
  for (const d of parsed.diagnostics) diagnostics.push({ ...d, where: input.name });
  const shift = (r: Rat) => (input.offset ? add(r, input.offset) : r);
  for (const t of parsed.tempo) tempoOut.push({ at: shift(t.at), bpm: t.bpm, channel: index });
  const notes: Note[] = parsed.notes.map((n) => ({
    id: nextNoteId(),
    start: shift(n.start),
    dur: n.dur,
    pitch: n.pitch,
    vol: n.vol,
    tie: n.tie,
  }));
  return {
    id: `t${index + 1}`,
    playerId: input.player.id,
    name: input.name,
    color: trackColor(index),
    role: "free",
    mute: false,
    solo: false,
    notes,
    spelling: {},
    mml: input.offset ? { text: input.text, offset: input.offset } : { text: input.text },
  };
}

/**
 * 채널마다 적힌 템포를 곡 템포 지도 하나로. 같은 자리 템포는 하나로 합친다.
 * 다른 채널이 이미 바꾼 빠르기를 조금 늦은 자리에 다시 적은 t(출력기가 악보마다 템포를 넣다 음 경계로 옮겨 적은 t)는
 * 소리를 바꾸지 않으므로 지도에 넣지 않는다. 한 채널 안에서 같은 빠르기를 일부러 다시 적은 t는 둔다
 */
export function mergeTempo(events: readonly ChannelTempo[]): TempoEvent[] {
  const sorted = [...events].sort((a, b) => cmp(a.at, b.at) || a.channel - b.channel);
  const out: TempoEvent[] = [];
  const lastOf = new Map<number, number>();
  for (const e of sorted) {
    const current = out[out.length - 1];
    const own = lastOf.get(e.channel);
    lastOf.set(e.channel, e.bpm);
    if (current && cmp(current.at, e.at) === 0) {
      out[out.length - 1] = { at: e.at, bpm: e.bpm };
      continue;
    }
    if (current && current.bpm === e.bpm && own !== e.bpm) continue;
    out.push({ at: e.at, bpm: e.bpm });
  }
  return out;
}

/**
 * 파일 바이트를 문자열로. 3MLE 파일은 보통 `Encoding=ks_c_5601-1987`(CP949)이다.
 * 머리에 적힌 인코딩을 먼저 보고, 없으면 UTF-8로 읽되 깨지면 EUC-KR로 다시 읽는다.
 */
export function decodeText(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512));
  const declared = /Encoding=([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  if (declared && /ks_c_5601|euc-kr|cp949|949/.test(declared)) {
    return new TextDecoder("euc-kr").decode(bytes);
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("euc-kr").decode(bytes);
}

/**
 * 모든 트랙에 사용자가 쓴 원문이 있고, 원문 속 템포를 모으면 곡 템포 지도와 같고(들리는 템포로 비교),
 * 악보마다 곡 템포가 모두 적혀 있으면 원문 목록을 준다 (게임은 악보마다 템포를 따로 읽는다).
 * 이때는 다시 출력하지 않고 원문을 그대로 저장해서 쓴 사람의 표기(l·o·v 습관, 주석)를 지킨다.
 * 하나라도 아니면 undefined (출력기로 새로 쓴다).
 */
export function verbatimTexts(song: Song): string[] | undefined {
  const texts: string[] = [];
  const tempo: TempoEvent[] = [];
  for (const track of song.tracks) {
    if (!track.mml || track.mml.offset) return undefined;
    texts.push(track.mml.text);
    tempo.push(...parseMml(track.mml.text).tempo);
  }
  if (!sameTempo(audibleTempo(tempo), audibleTempo(song.tempo))) return undefined;
  return scoresMissingTempo(song).length === 0 ? texts : undefined;
}
