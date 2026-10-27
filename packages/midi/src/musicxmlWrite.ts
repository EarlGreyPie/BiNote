import { add, cmp, meterGrid, mul, rat, sub, trackInstrument, ZERO, type InstrumentRef, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { soundNotes, type SmfExportOptions } from "./export.js";
import { GM_DRUM_KEY, gmProgramOf } from "./gm.js";
import { escapeXml } from "./xml.js";

/**
 * 곡을 MusicXML(score-partwise 4.0, 압축 안 한 .musicxml)로 내보낸다 (실험실). 악보 프로그램에서 보고 인쇄하려는 것이다.
 * - 연주자(같은 악보 안에서도 악기가 다르면 따로)마다 파트 하나, 트랙마다 성부(voice) 하나
 * - 위치·길이는 정확하다: divisions를 곡의 모든 분모가 나누어떨어지는 값으로 잡고, 2의 거듭제곱이 아닌 길이는 잇단음표(time-modification)로 쓴다
 * - 마디선을 넘는 음은 붙임줄로 나눈다. 같은 높이 &는 붙임줄, 다른 높이 &(슬라이드)는 slide 기호를 붙인 따로 친 음이다
 * - v는 음마다 dynamics 속성(세기 = v×127/최대, MIDI 내보내기와 같음)으로, 성부 1에는 셈여림 기호(pp~ff)도 바뀔 때마다 적는다
 * - v0 음은 소리가 나지 않으니 쉼표로 쓴다. 템포는 첫 파트에 metronome + sound tempo
 * - 타브 줄(Note.tabString)은 technical/string으로 적는다. 프렛·튜닝은 쓰지 않는다
 */
export interface MusicXmlExportOptions extends SmfExportOptions {
  /** v 최댓값 (프로필) */
  readonly volumeMax?: number;
  /** encoding-date (YYYY-MM-DD). 없으면 쓰지 않는다 */
  readonly date?: string;
  /** encoding/software. 기본 "BiNote" */
  readonly software?: string;
}

const STEP_NAMES = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"] as const;
const STEP_ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] as const;
const TYPE_NAMES: readonly [number, string][] = [
  [1, "whole"],
  [2, "half"],
  [4, "quarter"],
  [8, "eighth"],
  [16, "16th"],
  [32, "32nd"],
  [64, "64th"],
  [128, "128th"],
  [256, "256th"],
  [512, "512th"],
  [1024, "1024th"],
];
const MARKS: readonly [number, string][] = [
  [16, "ppp"],
  [33, "pp"],
  [49, "p"],
  [64, "mp"],
  [80, "mf"],
  [96, "f"],
  [112, "ff"],
  [126, "fff"],
];

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/** 한 조각의 모양: 실제 길이와 그려 보일 음표(모양·점·잇단) */
interface Shape {
  readonly dur: Rat;
  readonly type: string;
  readonly dots: number;
  readonly tuplet?: { readonly actual: number; readonly normal: number };
}

/**
 * 길이를 그릴 수 있는 음표 조각으로 나눈다 (붙임줄로 이을 조각). 분모의 홀수 부분 m이 1보다 크면
 * m:normal 잇단(normal = m보다 작은 가장 큰 2의 거듭제곱)으로 보고, 보이는 길이(실제 × m/normal)를 점음표까지 써서 나눈다
 */
export function shapesOf(d: Rat): Shape[] {
  let odd = d.d;
  while (odd % 2 === 0) odd /= 2;
  const normal = odd > 1 ? 2 ** Math.floor(Math.log2(odd - 1)) : 1;
  const tuplet = odd > 1 ? { actual: odd, normal } : undefined;
  const toActual = (shown: Rat) => (tuplet ? mul(shown, rat(normal, odd)) : shown);
  let rest = tuplet ? mul(d, rat(odd, normal)) : d;
  const out: Shape[] = [];
  while (rest.n > 0) {
    // 온음표보다 길면 온음표씩
    let value = rat(1);
    let index = 0;
    while (cmp(value, rest) > 0 && index < TYPE_NAMES.length - 1) {
      index++;
      value = rat(1, TYPE_NAMES[index]![0]);
    }
    if (cmp(value, rest) > 0) {
      // 가장 작은 모양보다도 짧음: 길이는 그대로 두고 가장 작은 모양으로 보인다
      out.push({ dur: toActual(rest), type: TYPE_NAMES[index]![1], dots: 0, ...(tuplet ? { tuplet } : {}) });
      break;
    }
    let shown = value;
    let dots = 0;
    for (let k = 1; k <= 2 && index + k < TYPE_NAMES.length; k++) {
      const more = add(shown, rat(1, TYPE_NAMES[index + k]![0]));
      if (cmp(more, rest) > 0) break;
      shown = more;
      dots = k;
    }
    out.push({ dur: toActual(shown), type: TYPE_NAMES[index]![1], dots, ...(tuplet ? { tuplet } : {}) });
    rest = sub(rest, shown);
  }
  return out;
}

interface Measure {
  readonly start: Rat;
  readonly end: Rat;
  readonly beats: number;
  readonly unit: number;
}

/** 곡 끝까지의 마디. 박자가 마디 중간에 바뀌면 그 앞 마디는 짧게 끝난다 */
function measuresOf(song: Song, end: Rat): Measure[] {
  const sigs = [...song.timeSig].sort((a, b) => cmp(a.at, b.at));
  const segments = sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...sigs] : sigs;
  const out: Measure[] = [];
  let pos: Rat = ZERO;
  let seg = 0;
  while (out.length === 0 || cmp(pos, end) < 0) {
    while (seg + 1 < segments.length && cmp(segments[seg + 1]!.at, pos) <= 0) seg++;
    const sig = segments[seg]!;
    let stop = add(pos, meterGrid(sig).measure);
    const next = segments[seg + 1]?.at;
    if (next && cmp(stop, next) > 0) stop = next;
    out.push({ start: pos, end: stop, beats: sig.beats, unit: sig.unit });
    pos = stop;
  }
  return out;
}

interface Unit {
  readonly name: string;
  readonly instrument: InstrumentRef;
  readonly canonical: string;
  readonly drumKey?: number;
  readonly program: number;
  /** 트랙마다 소리 나는 음 (같은 높이 & 합침, v0 뺌) */
  readonly voices: readonly Note[][];
}

/** 한 마디 한 성부 안의 조각 */
interface Piece {
  readonly start: Rat;
  readonly end: Rat;
  readonly note?: Note;
  readonly tieIn: boolean;
  readonly tieOut: boolean;
  readonly slideIn: boolean;
  readonly slideOut: boolean;
}

export function songToMusicXml(song: Song, options: MusicXmlExportOptions = {}): string {
  const volumeMax = options.volumeMax ?? 15;
  const velocityOf = (vol: number) => Math.max(1, Math.min(127, Math.round((vol * 127) / volumeMax)));
  const units: Unit[] = song.players.flatMap((player) => {
    const byInstrument = new Map<string, { instrument: InstrumentRef; tracks: Track[] }>();
    for (const track of song.tracks.filter((t) => t.playerId === player.id)) {
      const instrument = trackInstrument(song, track);
      const key = `${instrument.canonical}#${instrument.program ?? ""}@${instrument.packId ?? ""}`;
      const unit = byInstrument.get(key) ?? { instrument, tracks: [] };
      unit.tracks.push(track);
      byInstrument.set(key, unit);
    }
    const several = byInstrument.size > 1;
    return [...byInstrument.values()].map(({ instrument, tracks }) => {
      const canonical = options.canonicalOf?.(instrument.canonical, instrument.program, instrument.packId) ?? instrument.canonical;
      const drumKey = GM_DRUM_KEY[canonical];
      return {
        name: several ? `${player.name} (${canonical})` : player.name,
        instrument,
        canonical,
        ...(drumKey !== undefined ? { drumKey } : {}),
        program: gmProgramOf(canonical),
        voices: tracks.map((t) => soundNotes(t.notes)),
      };
    });
  });

  const tempo = [...song.tempo].sort((a, b) => cmp(a.at, b.at));
  let end: Rat = ZERO;
  for (const u of units) for (const v of u.voices) for (const n of v) if (cmp(add(n.start, n.dur), end) > 0) end = add(n.start, n.dur);
  for (const t of tempo) if (cmp(t.at, end) >= 0) end = add(t.at, rat(1, 4));
  const measures = measuresOf(song, end);

  // 마디·성부마다 조각
  const pieces = units.map((u) =>
    measures.map((m) =>
      u.voices.map((voice) => {
        const out: Piece[] = [];
        let at = m.start;
        voice.forEach((n, i) => {
          const nEnd = add(n.start, n.dur);
          if (cmp(nEnd, m.start) <= 0 || cmp(n.start, m.end) >= 0) return;
          const from = cmp(n.start, m.start) < 0 ? m.start : n.start;
          const to = cmp(nEnd, m.end) > 0 ? m.end : nEnd;
          if (cmp(from, at) > 0) out.push({ start: at, end: from, tieIn: false, tieOut: false, slideIn: false, slideOut: false });
          const prev = voice[i - 1];
          const next = voice[i + 1];
          const joinedPrev = !!prev && prev.tie === "next" && cmp(add(prev.start, prev.dur), n.start) === 0;
          const joinedNext = n.tie === "next" && !!next && cmp(nEnd, next.start) === 0;
          out.push({
            start: from,
            end: to,
            note: n,
            tieIn: cmp(from, n.start) > 0,
            tieOut: cmp(to, nEnd) < 0,
            slideIn: cmp(from, n.start) === 0 && joinedPrev && prev!.pitch !== n.pitch,
            slideOut: cmp(to, nEnd) === 0 && joinedNext && next!.pitch !== n.pitch,
          });
          at = to;
        });
        if (out.length > 0 && cmp(at, m.end) < 0) out.push({ start: at, end: m.end, tieIn: false, tieOut: false, slideIn: false, slideOut: false });
        return out;
      }),
    ),
  );

  // divisions: 모든 자리·조각 길이가 4분음표 단위 정수가 되게
  let divisions = 1;
  const need = (x: Rat) => {
    const q = rat(x.n * 4, x.d);
    divisions = lcm(divisions, q.d);
  };
  for (const m of measures) need(m.start);
  for (const t of tempo) need(t.at);
  for (const byMeasure of pieces) for (const byVoice of byMeasure) for (const list of byVoice) for (const p of list) for (const s of shapesOf(sub(p.end, p.start))) need(s.dur);
  const divs = (x: Rat) => {
    const q = mul(x, rat(divisions * 4));
    return q.n / q.d;
  };

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);
  w('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');
  if (song.meta.title) w(`  <work><work-title>${escapeXml(song.meta.title)}</work-title></work>`);
  w("  <identification>");
  if (song.meta.author) w(`    <creator type="composer">${escapeXml(song.meta.author)}</creator>`);
  w("    <encoding>");
  w(`      <software>${escapeXml(options.software ?? "BiNote")}</software>`);
  if (options.date) w(`      <encoding-date>${escapeXml(options.date)}</encoding-date>`);
  w("    </encoding>");
  w("  </identification>");
  w("  <part-list>");
  let melodicChannel = 0;
  units.forEach((u, k) => {
    const id = `P${k + 1}`;
    let channel = 10;
    if (u.drumKey === undefined) {
      channel = (melodicChannel % 15) + 1;
      if (channel >= 10) channel++;
      melodicChannel++;
    }
    w(`    <score-part id="${id}">`);
    w(`      <part-name>${escapeXml(u.name)}</part-name>`);
    w(`      <score-instrument id="${id}-I1"><instrument-name>${escapeXml(u.canonical)}</instrument-name></score-instrument>`);
    const program = u.drumKey === undefined ? `<midi-program>${u.program + 1}</midi-program>` : `<midi-unpitched>${u.drumKey + 1}</midi-unpitched>`;
    w(`      <midi-instrument id="${id}-I1"><midi-channel>${channel}</midi-channel>${program}</midi-instrument>`);
    w("    </score-part>");
  });
  w("  </part-list>");

  const markOf = (vol: number) => {
    const v = velocityOf(vol);
    let best = MARKS[0]!;
    for (const m of MARKS) if (Math.abs(m[0] - v) < Math.abs(best[0] - v)) best = m;
    return best[1];
  };

  units.forEach((u, k) => {
    const id = `P${k + 1}`;
    w(`  <part id="${id}">`);
    const all = u.voices.flat();
    const mean = all.length > 0 ? all.reduce((s, n) => s + n.pitch, 0) / all.length : 60;
    const clef = u.drumKey !== undefined ? "<sign>percussion</sign>" : mean < 55 ? "<sign>F</sign><line>4</line>" : "<sign>G</sign><line>2</line>";
    let lastMark: string | undefined;
    measures.forEach((m, mi) => {
      w(`    <measure number="${mi + 1}">`);
      const prev = measures[mi - 1];
      const timeChanged = !prev || prev.beats !== m.beats || prev.unit !== m.unit;
      if (mi === 0) {
        w("      <attributes>");
        w(`        <divisions>${divisions}</divisions>`);
        w("        <key><fifths>0</fifths></key>");
        w(`        <time><beats>${m.beats}</beats><beat-type>${m.unit}</beat-type></time>`);
        w(`        <clef>${clef}</clef>`);
        w("      </attributes>");
      } else if (timeChanged) {
        w(`      <attributes><time><beats>${m.beats}</beats><beat-type>${m.unit}</beat-type></time></attributes>`);
      }
      // 템포: 첫 파트에만, 마디 안 자리는 offset으로
      if (k === 0) {
        const here = tempo.filter((t) => cmp(t.at, m.start) >= 0 && cmp(t.at, m.end) < 0);
        if (mi === 0 && !tempo.some((t) => cmp(t.at, ZERO) === 0)) here.unshift({ at: ZERO, bpm: 120 });
        for (const t of here) {
          const bpm = Math.round(t.bpm * 100) / 100;
          const offset = divs(sub(t.at, m.start));
          w('      <direction placement="above">');
          w(`        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>`);
          if (offset > 0) w(`        <offset sound="yes">${offset}</offset>`);
          w(`        <sound tempo="${bpm}"/>`);
          w("      </direction>");
        }
      }
      const voices = pieces[k]![mi]!;
      const written = voices.map((list, v) => ({ list, v })).filter(({ list, v }) => v === 0 || list.some((p) => p.note));
      written.forEach(({ list, v }, wi) => {
        if (wi > 0) w(`      <backup><duration>${divs(sub(m.end, m.start))}</duration></backup>`);
        if (list.length === 0 || list.every((p) => !p.note)) {
          w(`      <note><rest measure="yes"/><duration>${divs(sub(m.end, m.start))}</duration><voice>${v + 1}</voice></note>`);
          return;
        }
        for (const p of list) {
          const n = p.note;
          if (n && v === 0 && (!p.tieIn || lastMark === undefined)) {
            const mark = markOf(n.vol);
            if (mark !== lastMark) {
              w(`      <direction placement="below"><direction-type><dynamics><${mark}/></dynamics></direction-type><voice>1</voice></direction>`);
              lastMark = mark;
            }
          }
          const shapes = shapesOf(sub(p.end, p.start));
          shapes.forEach((s, si) => {
            const tieIn = si > 0 || (!!n && p.tieIn);
            const tieOut = si < shapes.length - 1 || (!!n && p.tieOut);
            const parts: string[] = [];
            if (!n) parts.push("<rest/>");
            else if (u.drumKey !== undefined) parts.push("<unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched>");
            else {
              const alter = STEP_ALTER[n.pitch % 12]!;
              parts.push(`<pitch><step>${STEP_NAMES[n.pitch % 12]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${Math.floor(n.pitch / 12) - 1}</octave></pitch>`);
            }
            parts.push(`<duration>${divs(s.dur)}</duration>`);
            if (n && tieIn) parts.push('<tie type="stop"/>');
            if (n && tieOut) parts.push('<tie type="start"/>');
            if (n && u.drumKey !== undefined) parts.push(`<instrument id="${id}-I1"/>`);
            parts.push(`<voice>${v + 1}</voice>`);
            parts.push(`<type>${s.type}</type>`);
            for (let d = 0; d < s.dots; d++) parts.push("<dot/>");
            if (n && STEP_ALTER[n.pitch % 12] && u.drumKey === undefined) parts.push("<accidental>sharp</accidental>");
            if (s.tuplet) parts.push(`<time-modification><actual-notes>${s.tuplet.actual}</actual-notes><normal-notes>${s.tuplet.normal}</normal-notes></time-modification>`);
            if (n) {
              const notations: string[] = [];
              if (tieIn) notations.push('<tied type="stop"/>');
              if (tieOut) notations.push('<tied type="start"/>');
              if (si === 0 && p.slideIn) notations.push('<slide type="stop"/>');
              if (si === shapes.length - 1 && p.slideOut) notations.push('<slide type="start" line-type="solid"/>');
              if (n.tabString !== undefined && u.drumKey === undefined) notations.push(`<technical><string>${n.tabString}</string></technical>`);
              if (notations.length > 0) parts.push(`<notations>${notations.join("")}</notations>`);
            }
            const dynamics = n ? ` dynamics="${Math.round((velocityOf(n.vol) / 90) * 10000) / 100}"` : "";
            w(`      <note${dynamics}>${parts.join("")}</note>`);
          });
        }
      });
      w("    </measure>");
    });
    w("  </part>");
  });
  w("</score-partwise>");
  return lines.join("\n") + "\n";
}

