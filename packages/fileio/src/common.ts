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

/** CSS 색 이름 148개 → rrggbb (예전 파일에 저장된 red 같은 색도 그대로 읽고 고정할 수 있게) */
const CSS_NAMES = new Map(
  [
    "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4",
    "black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887",
    "cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc",
    "crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9",
    "darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00",
    "darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b",
    "darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493",
    "deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0",
    "forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080",
    "green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082",
    "ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd",
    "lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3",
    "lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa",
    "lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0",
    "lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa",
    "mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee",
    "mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa",
    "mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23",
    "orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee",
    "palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6",
    "purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513",
    "salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb",
    "slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c",
    "teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff",
    "whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32",
  ]
    .join(" ")
    .split(" ")
    .map((e) => e.split(":") as [string, string]),
);

/** 숫자 하나 (1..2·빈 칸·아주 긴 숫자처럼 쓸 수 없는 것은 받지 않는다) */
const NUM = String.raw`(\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})`;
/** 세 값을 모두 쉼표로, 또는 모두 빈칸으로 나눈 꼴만 (rgb(1,2 3)처럼 섞인 것은 CSS도 받지 않는다) */
const triple = (a: string, b: string, c: string) =>
  String.raw`(?:${a}\s*,\s*${b}\s*,\s*${c}|${a}\s+${b}\s+${c})`;
const RGB = new RegExp(String.raw`^rgb\(\s*${triple(NUM, NUM, NUM)}\s*\)$`);
const HSL = new RegExp(String.raw`^hsl\(\s*${triple(`${NUM}(?:deg)?`, `${NUM}%`, `${NUM}%`)}\s*\)$`);

/**
 * 트랙 색 문자열(#rgb·#rrggbb·rgb()·hsl()·CSS 색 이름)을 #rrggbb로. 모르는 꼴이면 undefined.
 * 파일에서 읽은 트랙 색은 이 꼴만 받는다 (색 고르기 칸·지금 색으로 고정이 다 쓸 수 있게)
 */
export function hexColor(color: string): string | undefined {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const named = CSS_NAMES.get(c);
  if (named) return `#${named}`;
  const byte = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  const rgb = RGB.exec(c);
  if (rgb) {
    // 쉼표 꼴은 1~3번, 빈칸 꼴은 4~6번 묶음
    const [r, g, b] = rgb[1] !== undefined ? [rgb[1], rgb[2], rgb[3]] : [rgb[4], rgb[5], rgb[6]];
    return `#${byte(Number(r))}${byte(Number(g))}${byte(Number(b))}`;
  }
  const hsl = HSL.exec(c);
  if (!hsl) return undefined;
  const [hv, sv, lv] = hsl[1] !== undefined ? [hsl[1], hsl[2], hsl[3]] : [hsl[4], hsl[5], hsl[6]];
  const h = Number(hv) % 360;
  const sat = Math.min(1, Number(sv) / 100);
  const l = Math.min(1, Number(lv) / 100);
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return byte((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return `#${f(0)}${f(8)}${f(4)}`;
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
  /** 채널 글 맨 끝(뒤에 음도 쉼표도 없음)에 적힌 템포. 끝 쉼표를 길이에 넣으려고 붙인 t(padScore)가 여기 든다 */
  readonly atEnd?: boolean;
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
  for (const t of parsed.tempo) tempoOut.push({ at: shift(t.at), bpm: t.bpm, channel: index, ...(cmp(t.at, parsed.end) >= 0 ? { atEnd: true } : {}) });
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
 * 소리를 바꾸지 않으므로 지도에 넣지 않는다. 한 채널 안에서 같은 빠르기를 일부러 다시 적은 t는 둔다.
 * 다만 채널 글 맨 끝에 같은 빠르기로 적은 t(끝 쉼표 길이를 지키려고 저장할 때 붙인 t)는 지도에 넣지 않는다:
 * 소리도 길이도 바꾸지 않는데, 넣으면 저장하고 다시 열 때마다 같은 빠르기 템포가 하나씩 늘어난다
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
    if (current && current.bpm === e.bpm && (own !== e.bpm || e.atEnd)) continue;
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
