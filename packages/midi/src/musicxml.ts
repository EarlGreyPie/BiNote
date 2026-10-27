import { add, cmp, div, INSTRUMENTS, mul, normalizeTempo, positionToSeconds, rat, sub, ZERO, type Rat, type TempoEvent, type TimeSigEvent } from "@mmlce/core";
import { polyphony, type MidiAnalysis, type MidiPart, type RawNote } from "./analyze.js";
import { suggestInstrument } from "./gm.js";
import { child, childrenOf, numberAt, parseXml, textAt, type XmlElement } from "./xml.js";

/**
 * MusicXML 가져오기 (실험실). 악보를 MIDI 가져오기와 같은 파트 목록(MidiAnalysis)으로 바꿔, 같은 악기 지정·화음 압축 창을 쓴다.
 * 위치·길이는 divisions를 그대로 옮긴 정확한 분수라 칸에 맞추지 않는다 (midiToSong의 quantize.exact).
 * 옮기는 것: 음·쉼표(빈자리)·붙임줄(한 음으로 합침)·잇단음표(길이 그대로)·템포·셈여림(세기 → v)·박자표·타브 줄 번호.
 * 옮기지 않는 것: 꾸밈음(grace)·큐 음·아티큘레이션·꾸밈 기호·페달·슬러·반복 기호(한 번만 친다)·cresc. 등. 건너뛴 것은 report로 알린다
 */
export interface MusicXmlReport {
  readonly title: string;
  /** encoding/software (예: "MuseScore 4.4.2", "BiNote") */
  readonly software: string;
  /** BiNote가 쓴 파일인지. 그러면 v가 이미 화음 감쇠를 거친 값이라 다시 감쇠하지 않는 것이 좋다 */
  readonly fromBiNote: boolean;
  /** 건너뛴 꾸밈음(grace) 수 */
  readonly grace: number;
  /** 건너뛴 큐 음 수 */
  readonly cue: number;
  /** 반복 기호(도돌이표·괄호·D.C.·D.S.·Coda 등) 수. 펼치지 않고 적힌 대로 한 번만 친다 */
  readonly repeats: number;
  /** 줄 번호(technical/string)를 받은 음 수 */
  readonly tabStrings: number;
  /** 세기 0이라 소리가 나지 않아 뺀 음 수 */
  readonly silent: number;
  /** 반음이 아닌 alter(미분음)라 가장 가까운 반음으로 반올림한 음 수 */
  readonly microtones: number;
  /** identification/creator type="composer" */
  readonly composer: string;
}

export interface MusicXmlImport {
  readonly analysis: MidiAnalysis;
  readonly report: MusicXmlReport;
}

export class MusicXmlError extends Error {}

/** MuseScore 등이 셈여림 기호에 쓰는 세기 */
const DYNAMIC_VELOCITY: Readonly<Record<string, number>> = {
  pppppp: 5,
  ppppp: 8,
  pppp: 10,
  ppp: 16,
  pp: 33,
  p: 49,
  mp: 64,
  mf: 80,
  f: 96,
  ff: 112,
  fff: 126,
  ffff: 127,
  fffff: 127,
  ffffff: 127,
  fp: 49,
  pf: 96,
  sf: 112,
  sfz: 112,
  sffz: 126,
  sfp: 49,
  sfpp: 33,
  fz: 112,
  rf: 112,
  rfz: 112,
  sfzp: 49,
};
const DEFAULT_VELOCITY = 80;

const STEPS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 음표 모양 → 온음표 단위 길이 */
const NOTE_TYPES: Readonly<Record<string, Rat>> = {
  maxima: rat(8),
  long: rat(4),
  breve: rat(2),
  whole: rat(1),
  half: rat(1, 2),
  quarter: rat(1, 4),
  eighth: rat(1, 8),
  "16th": rat(1, 16),
  "32nd": rat(1, 32),
  "64th": rat(1, 64),
  "128th": rat(1, 128),
  "256th": rat(1, 256),
};

/** 파트 이름·소리 이름에서 GM 악기 번호를 짐작한다 (midi-program이 없을 때) */
const NAME_PROGRAMS: readonly [RegExp, number][] = [
  [/music.?box|オルゴール|오르골|八音盒/i, 10],
  [/xylo|marimba|vibra|glock|실로폰|木琴/i, 13],
  [/harmonica|하모니카|ハーモニカ|口琴/i, 22],
  [/bass\s*guitar|e\.?\s*bass|electric bass|베이스 기타/i, 33],
  [/guitar|기타|ギター|吉他/i, 24],
  [/\blute|류트|リュート|鲁特|魯特/i, 25],
  [/mandolin|만돌린|マンドリン|曼陀林/i, 105],
  [/violin|viola|cello|fiddle|strings|바이올린|첼로|ヴァイオリン|バイオリン|小提琴/i, 40],
  [/harp|하프|ハープ|竖琴|豎琴/i, 46],
  [/clarinet|oboe|chalumeau|bassoon|샬루모|클라리넷|クラリネット|单簧管|單簧管/i, 71],
  [/flute|piccolo|recorder|플루트|フルート|长笛|長笛/i, 73],
  [/piano|keyboard|피아노|ピアノ|钢琴|鋼琴/i, 0],
];

/** "12.5" 같은 십진수를 정확한 분수로 */
function decimalRat(text: string | undefined): Rat | undefined {
  if (text === undefined) return undefined;
  const m = /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return undefined;
  // 안전한 정수 범위(15자리) 안에서 되도록 많은 소수 자리를 쓴다 (0.0000001 같은 divisions도 있다)
  const whole = (m[2] ?? "").replace(/^0+/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "").slice(0, Math.max(0, 15 - whole.length));
  const scale = 10 ** frac.length;
  const n = Number(whole || "0") * scale + Number(frac || "0");
  if (!Number.isSafeInteger(n)) return undefined;
  return rat(m[1] === "-" ? -n : n, scale);
}

interface PartInfo {
  readonly id: string;
  readonly name: string;
  readonly program?: number;
  readonly channel?: number;
  /** score-instrument id → GM 드럼 건반 (midi-unpitched - 1) */
  readonly unpitched: ReadonlyMap<string, number>;
  readonly soundHint: string;
  /** 첫 score-instrument 이름 (BiNote가 쓴 파일은 악기 공통 ID) */
  readonly instrumentName: string;
}

function partList(root: XmlElement): Map<string, PartInfo> {
  const out = new Map<string, PartInfo>();
  for (const sp of childrenOf(child(root, "part-list"), "score-part")) {
    const id = sp.attrs["id"] ?? "";
    const midis = childrenOf(sp, "midi-instrument");
    const first = midis[0];
    const unpitched = new Map<string, number>();
    for (const m of midis) {
      const key = numberAt(m, "midi-unpitched");
      if (key !== undefined && m.attrs["id"]) unpitched.set(m.attrs["id"], Math.max(0, Math.min(127, Math.round(key) - 1)));
    }
    const program = numberAt(first, "midi-program");
    const channel = numberAt(first, "midi-channel");
    const instruments = childrenOf(sp, "score-instrument");
    const soundHint = instruments.map((i) => `${textAt(i, "instrument-name") ?? ""} ${textAt(i, "instrument-sound") ?? ""}`).join(" ");
    out.set(id, {
      id,
      name: textAt(sp, "part-name") || textAt(sp, "part-abbreviation") || id,
      ...(program !== undefined ? { program: Math.max(0, Math.min(127, Math.round(program) - 1)) } : {}),
      ...(channel !== undefined ? { channel: Math.round(channel) - 1 } : {}),
      unpitched,
      soundHint,
      instrumentName: textAt(instruments[0], "instrument-name") ?? "",
    });
  }
  return out;
}

/** score-timewise면 score-partwise 모양(파트 → 마디)으로 바꾼다 */
function measuresByPart(root: XmlElement): { id: string; measures: XmlElement[] }[] {
  if (root.name === "score-partwise") return childrenOf(root, "part").map((p) => ({ id: p.attrs["id"] ?? "", measures: childrenOf(p, "measure") }));
  const byPart = new Map<string, XmlElement[]>();
  for (const measure of childrenOf(root, "measure")) {
    for (const p of childrenOf(measure, "part")) {
      const id = p.attrs["id"] ?? "";
      const list = byPart.get(id) ?? [];
      list.push(p);
      byPart.set(id, list);
    }
  }
  return [...byPart].map(([id, measures]) => ({ id, measures }));
}

interface LocalNote {
  /** 마디 시작에서의 위치 */
  readonly at: Rat;
  readonly dur: Rat;
  /** 적힌 높이 (이조 전). 이조는 시각 순으로 나중에 더한다 */
  readonly pitch: number;
  /** 음에 적힌 세기(dynamics 속성). 없으면 셈여림 기호를 시각 순으로 따라 정한다 */
  readonly velocity?: number;
  readonly staff: number;
  /** 성부 (voice). 붙임줄과 같은 높이 겹침을 성부마다 따로 다룬다 */
  readonly voice: string;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
  readonly string?: number;
  readonly drum: boolean;
}

/** 셈여림 바뀜. staff가 없으면 모든 보표 */
interface DynamicEvent {
  readonly at: Rat;
  readonly staff?: number;
  readonly velocity: number;
}

/** 이조 바뀜. staff가 없으면 모든 보표 */
interface TransposeEvent {
  readonly at: Rat;
  readonly staff?: number;
  readonly semitones: number;
}

interface LocalMeasure {
  readonly notes: LocalNote[];
  readonly transposes: TransposeEvent[];
  readonly tempo: { at: Rat; bpm: number }[];
  readonly dynamics: DynamicEvent[];
  /** 박자표 (마디 안 자리 포함, 적힌 순서) */
  readonly times: { at: Rat; beats: number; unit: number }[];
  /** 이 마디에서 가장 멀리 간 위치 (마디 길이) */
  readonly length: Rat;
}

interface PartRead {
  readonly id: string;
  readonly measures: LocalMeasure[];
  /** clef sign이 TAB인 보표 번호 */
  readonly tabStaves: ReadonlySet<number>;
}

interface Counts {
  grace: number;
  cue: number;
  repeats: number;
  silent: number;
  microtones: number;
}

function metronomeBpm(metronome: XmlElement): number | undefined {
  const unit = NOTE_TYPES[textAt(metronome, "beat-unit") ?? ""];
  const perMinute = decimalRat(textAt(metronome, "per-minute"));
  if (!unit || !perMinute || perMinute.n <= 0) return undefined;
  const dots = childrenOf(metronome, "beat-unit-dot").length;
  const len = (unit.n / unit.d) * (2 - 1 / 2 ** dots);
  return (perMinute.n / perMinute.d) * len * 4;
}

/**
 * 박자표 하나. beats·beat-type 쌍이 여럿이면(3/8 + 2/4) 가장 큰 분모로 맞춰 더한다 (7/8).
 * 한 beats 안의 "3+2"도 더한다. 분모가 2의 거듭제곱이 아니거나 읽을 수 없으면 undefined
 */
function timeOf(t: XmlElement | undefined): { beats: number; unit: number } | undefined {
  if (!t) return undefined;
  const pairs: { beats: number; unit: number }[] = [];
  let beats: number | undefined;
  for (const c of t.children) {
    if (c.name === "beats") beats = c.text.split("+").reduce((s, x) => s + (Number(x) || 0), 0);
    else if (c.name === "beat-type" && beats !== undefined) {
      const unit = Number(c.text.trim());
      if (Number.isInteger(unit) && unit > 0 && Number.isInteger(beats) && beats > 0) pairs.push({ beats, unit });
      beats = undefined;
    }
  }
  if (pairs.length === 0) return undefined;
  const unit = Math.max(...pairs.map((p) => p.unit));
  if (pairs.some((p) => unit % p.unit !== 0) || (unit & (unit - 1)) !== 0) return undefined;
  return { beats: pairs.reduce((s, p) => s + (p.beats * unit) / p.unit, 0), unit };
}

/**
 * 잇단음표의 모양(type·점·잇단)대로의 길이. 그 길이를 divisions 단위로 정확히 적을 수 없어 반올림한 파일(56·57처럼)이면
 * 한 division 안에서만 다를 때 모양대로를 쓴다. 그 밖에는 적힌 duration 그대로
 */
function nominal(el: XmlElement, written: Rat, divisions: Rat): Rat {
  const type = NOTE_TYPES[textAt(el, "type") ?? ""];
  if (!type || written.n <= 0) return written;
  const dots = childrenOf(el, "dot").length;
  let shown = type;
  for (let k = 1; k <= dots; k++) shown = add(shown, { n: type.n, d: type.d * 2 ** k });
  const tm = child(el, "time-modification");
  const actual = numberAt(tm, "actual-notes");
  const normal = numberAt(tm, "normal-notes");
  if (!tm || !actual || !normal || !Number.isInteger(actual) || !Number.isInteger(normal)) return written;
  const len = rat(shown.n * normal, shown.d * actual);
  // 모양대로의 길이(divisions 단위)가 정수가 아닐 때만 (반올림할 수밖에 없었던 파일)
  const inDivs = mul(len, mul(divisions, rat(4)));
  if (inDivs.d === 1) return written;
  const diff = mul(sub(len, written), mul(divisions, rat(4)));
  return Math.abs(diff.n / diff.d) < 1 ? len : written;
}

function readPart(id: string, measures: readonly XmlElement[], info: PartInfo | undefined, counts: Counts): PartRead {
  // 4분음표 하나의 divisions. 소수일 수 있다
  let divisions: Rat = rat(1);
  const tabStaves = new Set<number>();
  const out: LocalMeasure[] = [];
  const whole = (divs: Rat) => div(divs, mul(divisions, rat(4)));
  const durationOf = (el: XmlElement | undefined): Rat | undefined => {
    const r = decimalRat(textAt(el, "duration"));
    return r ? whole(r) : undefined;
  };
  for (const measure of measures) {
    const notes: LocalNote[] = [];
    const tempo: { at: Rat; bpm: number }[] = [];
    const dynamics: DynamicEvent[] = [];
    const transposes: TransposeEvent[] = [];
    const times: { at: Rat; beats: number; unit: number }[] = [];
    let pos: Rat = ZERO;
    let far: Rat = ZERO;
    let lastStart: Rat = ZERO;
    const reach = () => {
      if (cmp(pos, far) > 0) far = pos;
    };
    const setVelocity = (at: Rat, v: number, staff: number | undefined) => {
      const velocity = Math.max(0, Math.min(127, v));
      dynamics.push({ at, velocity, ...(staff !== undefined ? { staff } : {}) });
    };
    const soundOf = (sound: XmlElement | undefined, at: Rat, staff: number | undefined) => {
      if (!sound) return;
      const bpm = decimalRat(sound.attrs["tempo"]);
      if (bpm && bpm.n > 0) tempo.push({ at, bpm: bpm.n / bpm.d });
      const dyn = decimalRat(sound.attrs["dynamics"]);
      if (dyn && dyn.n >= 0) setVelocity(at, Math.round((dyn.n / dyn.d) * 0.9), staff);
      for (const key of ["dacapo", "dalsegno", "tocoda", "coda", "segno", "fine"]) if (sound.attrs[key] !== undefined) counts.repeats++;
    };
    for (const el of measure.children) {
      switch (el.name) {
        case "attributes": {
          const divText = decimalRat(textAt(el, "divisions"));
          if (divText && divText.n > 0) divisions = divText;
          const time = timeOf(child(el, "time"));
          if (time) times.push({ at: pos, ...time });
          for (const tr of childrenOf(el, "transpose")) {
            const semis = (numberAt(tr, "chromatic") ?? 0) + 12 * (numberAt(tr, "octave-change") ?? 0);
            const number = tr.attrs["number"];
            transposes.push({ at: pos, semitones: semis, ...(number !== undefined ? { staff: Number(number) } : {}) });
          }
          for (const clef of childrenOf(el, "clef")) {
            const staff = Number(clef.attrs["number"] ?? "1");
            if ((textAt(clef, "sign") ?? "").toUpperCase() === "TAB") tabStaves.add(staff);
            else tabStaves.delete(staff);
          }
          break;
        }
        case "backup": {
          const d = durationOf(el);
          if (d) pos = cmp(d, pos) > 0 ? ZERO : sub(pos, d);
          break;
        }
        case "forward": {
          const d = durationOf(el);
          if (d) pos = add(pos, d);
          reach();
          break;
        }
        case "direction": {
          const offset = decimalRat(textAt(el, "offset"));
          const at = offset ? add(pos, whole(offset)) : pos;
          const staffNum = numberAt(el, "staff");
          for (const dt of childrenOf(el, "direction-type")) {
            const dyn = child(dt, "dynamics");
            const mark = dyn?.children.find((c) => DYNAMIC_VELOCITY[c.name] !== undefined)?.name;
            if (mark) setVelocity(at, DYNAMIC_VELOCITY[mark]!, staffNum);
            const metronome = child(dt, "metronome");
            const bpm = metronome && !child(el, "sound")?.attrs["tempo"] ? metronomeBpm(metronome) : undefined;
            if (bpm) tempo.push({ at, bpm });
            if (child(dt, "segno") || child(dt, "coda")) counts.repeats++;
          }
          soundOf(child(el, "sound"), at, staffNum);
          break;
        }
        case "sound":
          soundOf(el, pos, undefined);
          break;
        case "barline":
          if (child(el, "repeat")) counts.repeats++;
          if (child(el, "ending")?.attrs["type"] === "start") counts.repeats++;
          break;
        case "note": {
          const isChord = !!child(el, "chord");
          if (child(el, "grace")) {
            counts.grace++;
            break;
          }
          const d = nominal(el, durationOf(el) ?? ZERO, divisions);
          const start = isChord ? lastStart : pos;
          if (!isChord) {
            lastStart = pos;
            pos = add(pos, d);
            reach();
          }
          if (child(el, "rest") || child(el, "cue") || d.n <= 0) {
            if (child(el, "cue") && !child(el, "rest")) counts.cue++;
            break;
          }
          const staff = numberAt(el, "staff") ?? 1;
          let pitch: number | undefined;
          let drum = false;
          const p = child(el, "pitch");
          const up = child(el, "unpitched");
          if (p) {
            const step = STEPS[(textAt(p, "step") ?? "").toUpperCase()];
            const octave = numberAt(p, "octave");
            if (step === undefined || octave === undefined) break;
            const alter = numberAt(p, "alter") ?? 0;
            if (!Number.isInteger(alter)) counts.microtones++;
            pitch = (octave + 1) * 12 + step + Math.round(alter);
          } else if (up) {
            drum = true;
            const instrumentId = child(el, "instrument")?.attrs["id"];
            const mapped = instrumentId !== undefined ? info?.unpitched.get(instrumentId) : [...(info?.unpitched.values() ?? [])][0];
            if (mapped !== undefined) pitch = mapped;
            else {
              const step = STEPS[(textAt(up, "display-step") ?? "").toUpperCase()];
              const octave = numberAt(up, "display-octave");
              if (step === undefined || octave === undefined) break;
              pitch = (octave + 1) * 12 + step;
            }
          } else break;
          // 음역 밖 높이도 버리지 않는다: 가져오기(midiToSong)가 프로필 옥타브 범위로 접고 알린다
          const ties = childrenOf(el, "tie").map((t) => t.attrs["type"]);
          const tied = childrenOf(child(el, "notations"), "tied").map((t) => t.attrs["type"]);
          const kinds = ties.length > 0 ? ties : tied;
          const dynAttr = decimalRat(el.attrs["dynamics"]);
          const string = numberAt(child(el, "notations"), "technical", "string");
          notes.push({
            at: start,
            dur: d,
            pitch,
            ...(dynAttr && dynAttr.n >= 0 ? { velocity: Math.max(0, Math.min(127, Math.round((dynAttr.n / dynAttr.d) * 0.9))) } : {}),
            staff,
            voice: textAt(el, "voice") || "1",
            tieStart: kinds.includes("start") || kinds.includes("continue"),
            tieStop: kinds.includes("stop") || kinds.includes("continue"),
            ...(string !== undefined && string >= 1 ? { string: Math.round(string) } : {}),
            drum,
          });
          break;
        }
      }
    }
    out.push({ notes, transposes, tempo, dynamics, times, length: far });
  }
  return { id, measures: out, tabStaves };
}

interface GlobalNote extends LocalNote {
  start: Rat;
  dur: Rat;
  velocity: number;
  voice: string;
  /** 음에 dynamics 속성이 적혀 있었는지 */
  explicit: boolean;
  string?: number;
  staff: number;
}

/** BiNote가 쓴 파일은 악기 이름이 공통 ID라 그 악기를 그대로 고른다 (GM 번호로는 고양이 하모니카가 하모니카가 되는 등) */
function ownCanonical(fromBiNote: boolean, info: PartInfo | undefined) {
  if (!fromBiNote || !info) return undefined;
  const found = INSTRUMENTS.find((i) => i.id === info.instrumentName && !i.percussion);
  return found ? { canonical: found.id, matched: true, alternatives: [] } : undefined;
}

/**
 * 붙임줄로 이은 같은 높이 음을 한 음으로 합친다. 성부마다 따로 잇고 (다른 성부의 같은 높이 음이 끊지 않게),
 * 같은 성부에 이을 음이 없으면 같은 보표의 다른 성부에서 바로 앞에 끝난 같은 높이 음을 찾는다 (성부를 넘는 붙임줄)
 */
function joinTies(notes: readonly GlobalNote[]): GlobalNote[] {
  // 같은 시각에는 붙임줄을 받는 음을 먼저 (붙임줄 없는 같은 높이 음이 열린 붙임줄을 먼저 닫지 않게)
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start) || Number(!!b.tieStop) - Number(!!a.tieStop) || b.pitch - a.pitch);
  const out: GlobalNote[] = [];
  const open = new Map<string, GlobalNote>();
  for (const n of sorted) {
    const key = `${n.staff}:${n.voice}:${n.pitch}`;
    let prevKey: string | undefined = key;
    let prev = open.get(key);
    const meets = (p: GlobalNote | undefined) => !!p && cmp(add(p.start, p.dur), n.start) === 0;
    if (n.tieStop && !meets(prev)) {
      prev = undefined;
      prevKey = undefined;
      // 같은 보표의 다른 성부를 먼저, 없으면 다른 보표에서 (보표를 넘는 붙임줄)
      const candidates = [...open].sort(([, a], [, b]) => Number(a.staff !== n.staff) - Number(b.staff !== n.staff));
      for (const [k, p] of candidates) {
        if (p.pitch === n.pitch && meets(p)) {
          prev = p;
          prevKey = k;
          break;
        }
      }
    }
    if (n.tieStop && prev && prevKey) {
      prev.dur = add(prev.dur, n.dur);
      // 다른 성부·보표로 이어졌으면 합친 음은 어느 성부에도 속하지 않게 한다 (같은 성부의 다음 같은 높이 음에 잘리지 않게)
      if (prev.voice !== n.voice || prev.staff !== n.staff) prev.voice = `${prev.voice}~${n.staff}:${n.voice}`;
      if (prev.string === undefined && n.string !== undefined) prev.string = n.string;
      open.delete(prevKey);
      if (n.tieStart) open.set(key, prev);
      continue;
    }
    const copy: GlobalNote = { ...n };
    out.push(copy);
    if (n.tieStart) open.set(key, copy);
    else open.delete(key);
  }
  return out;
}

/** MusicXML 글 → 파트 목록. 읽을 수 없으면 MusicXmlError */
export function readMusicXml(source: string): MusicXmlImport {
  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (e) {
    throw new MusicXmlError(e instanceof Error ? e.message : String(e));
  }
  if (root.name !== "score-partwise" && root.name !== "score-timewise") throw new MusicXmlError(`MusicXML 악보가 아닙니다: ${root.name}`);
  const infos = partList(root);
  const counts: Counts = { grace: 0, cue: 0, repeats: 0, silent: 0, microtones: 0 };
  let reads: PartRead[];
  try {
    reads = measuresByPart(root).map(({ id, measures }) => readPart(id, measures, infos.get(id), counts));
  } catch (e) {
    // 분수가 안전한 정수 범위를 넘는 등
    throw new MusicXmlError(e instanceof Error ? e.message : String(e));
  }

  // 마디 시작: 마디 길이는 파트마다 가장 멀리 간 위치 가운데 가장 긴 것 (못갖춘마디도 그대로). 빈 마디는 그때 박자표 한 마디
  const count = Math.max(0, ...reads.map((r) => r.measures.length));
  const starts: Rat[] = [];
  const timeSig: TimeSigEvent[] = [];
  let sig = { beats: 4, unit: 4 };
  let at: Rat = ZERO;
  for (let m = 0; m < count; m++) {
    starts.push(at);
    // 박자표는 박자표를 적은 첫 파트의 것 (파트마다 같게 적는다). 마디 중간 바뀜도 그 자리에
    const times = reads.map((r) => r.measures[m]?.times ?? []).find((t) => t.length > 0) ?? [];
    for (const time of times) {
      const where = add(at, time.at);
      if (cmp(time.at, ZERO) === 0) sig = time;
      const prev = timeSig.at(-1);
      if (prev && cmp(prev.at, where) === 0) timeSig[timeSig.length - 1] = { at: where, beats: time.beats, unit: time.unit };
      else if (!prev || prev.beats !== time.beats || prev.unit !== time.unit) timeSig.push({ at: where, beats: time.beats, unit: time.unit });
    }
    let len: Rat = ZERO;
    for (const r of reads) {
      const l = r.measures[m]?.length;
      if (l && cmp(l, len) > 0) len = l;
    }
    if (len.n === 0) len = rat(sig.beats, sig.unit);
    const last = times.at(-1);
    if (last) sig = last;
    at = add(at, len);
  }
  if (timeSig.length > 0 && cmp(timeSig[0]!.at, ZERO) > 0) timeSig.unshift({ at: ZERO, beats: 4, unit: 4 });

  const tempoRaw: TempoEvent[] = [];
  for (const r of reads) {
    r.measures.forEach((m, k) => {
      for (const t of m.tempo) tempoRaw.push({ at: add(starts[k]!, t.at), bpm: t.bpm });
    });
  }
  // 같은 자리 템포는 여러 파트에 겹쳐 적히곤 한다: 하나만 남기고, 앞과 같은 빠르기는 뺀다
  const tempo: TempoEvent[] = [];
  for (const t of normalizeTempo(tempoRaw)) if (tempo.at(-1)?.bpm !== t.bpm) tempo.push(t);

  const software = childrenOf(child(child(root, "identification"), "encoding"), "software")
    .map((s) => s.text.trim())
    .join(", ");
  const fromBiNote = /\bBiNote\b/.test(software);
  const parts: MidiPart[] = [];
  let tabStrings = 0;
  for (const r of reads) {
    const info = infos.get(r.id);
    // 셈여림은 적힌 순서가 아니라 시각 순으로: 음 시작 시각까지 나온 마지막 셈여림 (같은 시각이면 나중에 적힌 것)
    const dyns = r.measures.flatMap((m, k) => m.dynamics.map((d, order) => ({ ...d, at: add(starts[k]!, d.at), k, order })));
    dyns.sort((a, b) => cmp(a.at, b.at) || a.k - b.k || a.order - b.order);
    const velocityAt = (start: Rat, staff: number) => {
      let v = DEFAULT_VELOCITY;
      for (const d of dyns) {
        if (cmp(d.at, start) > 0) break;
        if (d.staff === undefined || d.staff === staff) v = d.velocity;
      }
      return v;
    };
    // 이조도 적힌 순서가 아니라 시각 순으로 (마디 중간 이조 바뀜 뒤 backup으로 앞 성부를 적는 파일)
    const trs = r.measures.flatMap((m, k) => m.transposes.map((t, order) => ({ ...t, at: add(starts[k]!, t.at), k, order })));
    trs.sort((a, b) => cmp(a.at, b.at) || a.k - b.k || a.order - b.order);
    const transposeAt = (start: Rat, staff: number) => {
      let semis = 0;
      for (const t of trs) {
        if (cmp(t.at, start) > 0) break;
        if (t.staff === undefined || t.staff === staff) semis = t.semitones;
      }
      return semis;
    };
    const all: GlobalNote[] = [];
    r.measures.forEach((m, k) => {
      for (const n of m.notes) {
        const start = add(starts[k]!, n.at);
        all.push({
          ...n,
          start,
          dur: n.dur,
          pitch: n.drum ? n.pitch : n.pitch + transposeAt(start, n.staff),
          velocity: n.velocity ?? velocityAt(start, n.staff),
          explicit: n.velocity !== undefined,
        });
      }
    });
    // 세기 0(무음)으로 시작한 음은 소리가 나지 않으니 뺀다 (붙임줄로 이은 뒤 음도 함께)
    const joined = joinTies(all);
    let notes = joined.filter((n) => n.velocity > 0);
    counts.silent += joined.length - notes.length;
    // 오선 보표와 TAB 보표가 같은 음을 두 번 적은 파트: 오선에 같은 음이 있는 TAB 음은 줄 번호만 옮기고 빼며,
    // 오선에 없는 TAB 음은 첫 오선 보표의 음으로 남긴다 (음을 잃지 않게)
    const firstStaff = notes.find((n) => !r.tabStaves.has(n.staff))?.staff;
    if (r.tabStaves.size > 0 && firstStaff !== undefined) {
      const tabNotes = notes.filter((n) => r.tabStaves.has(n.staff));
      notes = notes.filter((n) => !r.tabStaves.has(n.staff));
      for (const tn of tabNotes) {
        // 같은 음을 두 번 적은 것: 같은 자리·높이·길이이고, 둘 다 세기를 적었다면 세기도 같아야 한다
        const target = notes.find(
          (n) =>
            !r.tabStaves.has(n.staff) &&
            n.pitch === tn.pitch &&
            cmp(n.start, tn.start) === 0 &&
            cmp(n.dur, tn.dur) === 0 &&
            (!n.explicit || !tn.explicit || n.velocity === tn.velocity) &&
            (n.string === undefined || n.string === tn.string),
        );
        if (target) {
          if (tn.string !== undefined) target.string = tn.string;
        } else notes.push({ ...tn, staff: firstStaff, voice: `tab${tn.staff}:${tn.voice}` });
      }
    }
    tabStrings += notes.filter((n) => n.string !== undefined).length;
    const staves = [...new Set(notes.map((n) => n.staff))].sort((a, b) => a - b);
    const name = info?.name ?? r.id;
    let program = info?.program;
    if (program === undefined) {
      const hint = `${name} ${info?.soundHint ?? ""}`;
      program = NAME_PROGRAMS.find(([re]) => re.test(hint))?.[1] ?? 0;
    }
    for (const staff of staves) {
      const own = notes.filter((n) => n.staff === staff);
      const drum = info?.channel === 9 || own.some((n) => n.drum);
      const raw: RawNote[] = own
        .map((n) => ({
          start: n.start,
          dur: n.dur,
          seconds: positionToSeconds(tempo, n.start),
          pitch: n.pitch,
          velocity: n.velocity,
          voice: n.voice,
          ...(n.string !== undefined && !drum ? { string: n.string } : {}),
        }))
        .sort((a, b) => a.seconds - b.seconds || b.pitch - a.pitch);
      const pitches = raw.map((n) => n.pitch);
      parts.push({
        id: staves.length > 1 ? `${r.id}s${staff}` : r.id,
        // 기본 배정은 MusicXML 파트(큰보표 두 손)끼리만 한 연주자로 묶는다
        group: r.id,
        track: parts.length,
        channel: info?.channel ?? 0,
        name: staves.length > 1 ? `${name} ${staff}` : name,
        program,
        drum,
        notes: raw,
        low: pitches.reduce((a, b) => Math.min(a, b), Infinity),
        high: pitches.reduce((a, b) => Math.max(a, b), -Infinity),
        polyphony: polyphony(raw),
        suggestion: drum
          ? { canonical: "bass-drum", matched: true, alternatives: ["cymbal"] }
          : ownCanonical(fromBiNote, info) ?? suggestInstrument(program),
      });
    }
  }

  const title = textAt(root, "work", "work-title") || textAt(root, "movement-title") || "";
  const composer =
    childrenOf(child(root, "identification"), "creator")
      .find((c) => c.attrs["type"] === "composer")
      ?.text.trim() ?? "";
  return {
    analysis: { ppq: 480, parts, tempo, timeSig },
    report: { title, software, fromBiNote, grace: counts.grace, cue: counts.cue, repeats: counts.repeats, tabStrings, silent: counts.silent, microtones: counts.microtones, composer },
  };
}

/** 글이 MusicXML 악보처럼 보이는지 (.xml 확장자를 3MLE 글과 가를 때). 앞의 주석이 길어도 글 전체에서 찾는다 */
export function looksLikeMusicXml(text: string): boolean {
  return /<score-(partwise|timewise)[\s>]/.test(text);
}

/**
 * MusicXML 파일 바이트 → 글. BOM(UTF-8·UTF-16)과 XML 선언의 encoding을 따른다. 모르는 인코딩이면 UTF-8
 */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  // BOM 없는 UTF-16: 첫 글자 '<' 옆이 0
  if (bytes[0] === 0x3c && bytes[1] === 0) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0 && bytes[1] === 0x3c) return new TextDecoder("utf-16be").decode(bytes);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const label = /^<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  if (label) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // 브라우저가 모르는 인코딩 이름
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}
