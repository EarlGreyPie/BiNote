import { staffSpell, toFloat, type StaffAccidental, type StaffBar, type StaffClef, type StaffItem, type StaffTrack } from "@mmlce/core";
import { STAFF_ROW, STAFF_TOP, type BarPlace, type TimeAnchors } from "./staffLayout";

/**
 * 오선보 그리기 (VexFlow, MIT). VexFlow는 오선보 보기를 처음 켤 때만 불러온다 (번들 따로, 꺼 두면 받지 않는다).
 * 보이는 마디만 SVG 하나에 그리고, 그린 음표 자리(시간 → x)와 누를 자리를 돌려준다
 */
export type VexFlowModule = typeof import("vexflow/bravura");

let loading: Promise<VexFlowModule> | undefined;

/** VexFlow와 악보 글꼴(Bravura·Academico, 둘 다 SIL OFL) 불러오기. 한 번만 받는다 */
export function loadVexFlow(): Promise<VexFlowModule> {
  loading ??= (async () => {
    const vf = await import("vexflow/bravura");
    // 글꼴이 다 오기 전에 그리면 음표 머리 자리가 틀어진다
    await Promise.allSettled([document.fonts.load("30px Bravura"), document.fonts.load("12px Academico")]);
    return vf;
  })();
  loading.catch(() => (loading = undefined));
  return loading;
}

/** 오선 한 단 (트랙 하나, 또는 큰보표의 위·아래 단) */
export interface StaffRow {
  /** 이름·색을 가져온 트랙 (큰보표는 악보의 첫 트랙) */
  readonly trackId: string;
  /** 단 이름 (큰보표 아래 단은 비운다) */
  readonly name: string;
  readonly color: string;
  readonly clef: StaffClef;
  /** 성부 (둘이면 첫째는 기둥 위, 둘째는 아래) */
  readonly voices: readonly StaffTrack[];
  /** 큰보표 위 단: 다음 단과 중괄호로 묶는다 */
  readonly braceDown?: boolean;
  /**
   * 음자리표 옥타브 표시. "8vb": 적은 음보다 한 옥타브 낮게 소리 난다 (기타. 음은 한 옥타브 높여 적었다),
   * "8va": 한 옥타브 높게 소리 난다 (실로폰·오르골. 음은 MML 높이 그대로)
   */
  readonly octave?: "8va" | "8vb";
}

export interface StaffInk {
  readonly text: string;
  readonly muted: string;
  /** 박자 밖이라 그리기용으로 맞춘 음 */
  readonly approx: string;
  /** 오선·마디선. 음표보다 옅게 그려 어두운 화면에서도 음표가 줄에 묻히지 않게 */
  readonly line: string;
}

/**
 * 음표 하나의 모든 부분(머리·기둥·꼬리·덧줄)에 같은 색을 준다.
 * VexFlow는 기둥·덧줄을 따로 그리며 기본색(검정)을 써서, 어두운 화면에서 기둥이 사라지고 덧줄이 안 보였다
 */
function inkNote(note: { setStyle(s: object): unknown; setStemStyle(s: object): unknown; setFlagStyle(s: object): unknown; setLedgerLineStyle(s: object): unknown }, color: string): void {
  const style = { fillStyle: color, strokeStyle: color };
  note.setStyle(style);
  note.setStemStyle(style);
  note.setFlagStyle(style);
  note.setLedgerLineStyle(style);
}

export interface StaffHit {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly trackId: string;
  readonly noteId: string;
}

export interface StaffDrawn {
  /** 마디 순서 → 그 마디 음표 자리 (그림 칸 x) */
  readonly anchors: Map<number, TimeAnchors>;
  readonly hits: StaffHit[];
}

const DURATION: Record<number, string> = { 1: "w", 2: "h", 4: "q", 8: "8", 16: "16", 32: "32", 64: "64" };

/** 쉼표를 둘 줄: 오선 가운데, 성부가 둘이면 첫째는 위·둘째는 아래로 비켜 둔다 */
function restKey(clef: StaffClef, voice = 0, count = 1): string {
  if (count > 1) return clef === "bass" ? (voice === 0 ? "f/3" : "a/2") : voice === 0 ? "d/5" : "f/4";
  return clef === "bass" ? "d/3" : "b/4";
}

function pitchKey(pitch: number, clef: StaffClef, fifths: number): string {
  // 타악기 단은 음높이 없이 가운데 줄에
  if (clef === "percussion") return "b/4";
  const p = staffSpell(pitch, fifths);
  return `${p.letter}${p.alter === 1 ? "#" : p.alter === -1 ? "b" : ""}/${p.octave}`;
}

/** 조표 → VexFlow 조 이름 (장조) */
const KEY_NAMES: Readonly<Record<number, string>> = { [-7]: "Cb", [-6]: "Gb", [-5]: "Db", [-4]: "Ab", [-3]: "Eb", [-2]: "Bb", [-1]: "F", 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#" };

export function keyName(fifths: number): string {
  return KEY_NAMES[fifths] ?? "C";
}

/** 음표 머리들 (낮은 음부터). 화음이면 여러 개, 임시표는 같은 순서로. 머리 자리는 마디의 조표로 적은 글자 */
function headsOf(item: StaffItem, clef: StaffClef, voice: number, count: number, fifths: number): { keys: string[]; accidentals: (StaffAccidental | undefined)[] } {
  if (item.pitch === undefined) return { keys: [restKey(clef, voice, count)], accidentals: [undefined] };
  if (clef === "percussion") return { keys: ["b/4"], accidentals: [undefined] };
  const heads = [{ pitch: item.pitch, accidental: item.accidental }, ...(item.chord ?? []).map((c) => ({ pitch: c.pitch, accidental: c.accidental }))].sort((a, b) => a.pitch - b.pitch);
  return { keys: heads.map((h) => pitchKey(h.pitch, clef, fifths)), accidentals: heads.map((h) => h.accidental) };
}

/**
 * 이 마디 앞에 조표를 그리는가. 조표가 바뀐 마디(다장조로 바뀌면 제자리표만), 곡 첫 마디(다장조가 아니면),
 * 줄바꿈 배치의 줄 첫 마디(다장조가 아니면)
 */
export function keyShown(bar: Pick<StaffBar, "fifths" | "showKey">, lineStart: boolean): boolean {
  return bar.showKey || (lineStart && bar.fifths !== 0);
}

/** 오선 한 단의 위 끝 (트랙 순서 r) */
export const rowY = (r: number) => STAFF_TOP + r * STAFF_ROW;

/**
 * [first, last] 마디를 host 안에 그린다 (host는 place.left[first] 자리에 놓인 칸). 앞 그림은 지운다.
 * place는 staffLayout에서 정한 마디 자리·폭 (한 줄 또는 줄바꿈한 줄 안). 돌려주는 자리도 place 기준
 */
export function drawStaff(
  vf: VexFlowModule,
  host: HTMLElement,
  bars: readonly StaffBar[],
  place: BarPlace,
  rows: readonly StaffRow[],
  range: readonly [number, number],
  ink: StaffInk,
  /** 줄바꿈 배치: 줄 첫 마디에 조표를 다시 그린다 (다장조가 아니면) */
  repeatKey = false,
): StaffDrawn {
  const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Tuplet, StaveTie, Accidental, Dot, Annotation, Fraction } = vf;
  host.replaceChildren();
  const [first, last] = range;
  const left = place.left[first]!;
  const width = place.left[last]! + place.width[last]! - left + 2;
  const height = rowY(rows.length) + 8;
  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  ctx.setFillStyle(ink.text);
  ctx.setStrokeStyle(ink.text);

  const anchors = new Map<number, TimeAnchors>();
  const hits: StaffHit[] = [];
  // 단마다 성부마다 (붙임줄을 마디 너머로 잇는다)
  const lanes = rows.flatMap((row, r) => row.voices.map((view, v) => ({ r, v, count: row.voices.length, view, clef: row.clef, trackId: row.trackId })));
  const drawn = lanes.map(() => new Map<StaffItem, InstanceType<typeof StaveNote>>());

  for (let i = first; i <= last; i++) {
    const bar = bars[i]!;
    const x = place.left[i]! - left;
    const w = place.width[i]!;
    const voices: InstanceType<typeof Voice>[] = [];
    const staves: InstanceType<typeof Stave>[] = [];
    const perLane: { lane: number; voice: InstanceType<typeof Voice>; notes: InstanceType<typeof StaveNote>[]; items: readonly StaffItem[]; tuplets: InstanceType<typeof Tuplet>[] }[] = [];
    const beat = bar.unit === 8 && bar.beats > 3 && bar.beats % 3 === 0 ? new Fraction(3, 8) : new Fraction(1, bar.unit);
    rows.forEach((_row, r) => {
      const stave = new Stave(x, rowY(r), w);
      // 타악기 단은 음높이가 없어 조표를 그리지 않는다
      if (rows[r]!.clef !== "percussion" && keyShown(bar, repeatKey && i === first)) {
        stave.addKeySignature(keyName(bar.fifths), bar.showKey && bar.cancelKey !== undefined ? keyName(bar.cancelKey) : undefined);
      }
      if (bar.showSig) stave.addTimeSignature(`${(bar.shownSig ?? bar).beats}/${(bar.shownSig ?? bar).unit}`);
      // 줄은 옅게, 조표·박자표는 음표 색으로
      stave.setStyle({ strokeStyle: ink.line, fillStyle: ink.line });
      for (const category of [vf.TimeSignature.CATEGORY, vf.KeySignature.CATEGORY]) {
        for (const mod of stave.getModifiers(vf.StaveModifierPosition.BEGIN, category)) mod.setStyle({ fillStyle: ink.text, strokeStyle: ink.text });
      }
      stave.setContext(ctx).drawWithStyle();
      staves.push(stave);
    });
    lanes.forEach((lane, li) => {
      const stave = staves[lane.r]!;
      const m = lane.view.measures[i];
      const { clef, v, count } = lane;
      const vexClef = clef === "percussion" ? "percussion" : clef;
      const items = m && !m.fullRest ? m.items : [];
      // 둘째 성부가 쉬는 마디는 그리지 않는다 (온쉼표가 첫 성부와 겹치지 않게)
      if (items.length === 0 && v > 0) return;
      const stem = count > 1 ? { stemDirection: v === 0 ? 1 : -1 } : { autoStem: true };
      const notes = items.map((item) => {
        const heads = headsOf(item, clef, v, count, bar.fifths);
        const note = new StaveNote({ keys: heads.keys, duration: DURATION[item.base] + (item.rest ? "r" : ""), dots: item.dots, clef: vexClef, ...stem });
        // 점은 하나씩 붙는다 (겹점음표는 두 번)
        for (let d = 0; d < item.dots; d++) Dot.buildAndAttach([note], { all: true });
        heads.accidentals.forEach((acc, k) => {
          if (acc) note.addModifier(new Accidental(acc), k);
        });
        if (item.dynamic) note.addModifier(new Annotation(item.dynamic).setFont("Academico", 13, "bold", "italic").setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0);
        inkNote(note, item.approx ? ink.approx : ink.text);
        note.setStave(stave);
        drawn[li]!.set(item, note);
        return note;
      });
      // 잇단음표 묶음 (박자 계산이 바뀌므로 성부에 넣기 전에)
      const groups = new Map<number, { notes: InstanceType<typeof StaveNote>[]; num: number; occupied: number }>();
      items.forEach((item, k) => {
        if (!item.tuplet) return;
        const g = groups.get(item.tuplet.group) ?? { notes: [], num: item.tuplet.num, occupied: item.tuplet.occupied };
        g.notes.push(notes[k]!);
        groups.set(item.tuplet.group, g);
      });
      const tuplets = [...groups.values()].map((g) => new Tuplet(g.notes, { numNotes: g.num, notesOccupied: g.occupied, bracketed: true, ratioed: false }));
      const voice = new Voice({ numBeats: bar.beats, beatValue: bar.unit }).setMode(Voice.Mode.SOFT);
      if (items.length === 0) {
        const rest = new StaveNote({ keys: [restKey(clef)], duration: "wr", clef: vexClef, alignCenter: true });
        inkNote(rest, ink.text);
        rest.setStave(stave);
        voice.addTickables([rest]);
      } else voice.addTickables(notes);
      voices.push(voice);
      perLane.push({ lane: li, voice, notes, items, tuplets });
    });
    const noteStart = Math.max(...staves.map((s) => s.getNoteStartX())) - x;
    // 단들을 함께 맞춰 같은 시간의 음이 위아래로 줄 서게 한다
    // joinVoices: 임시표·점·셈여림 자리(ModifierContext)를 만든다 (format만으로는 만들지 않는다)
    new Formatter().joinVoices(voices).format(voices, Math.max(20, w - noteStart - 12));
    const beams: InstanceType<typeof Beam>[] = [];
    for (const pl of perLane) {
      const lane = lanes[pl.lane]!;
      // 성부가 둘이면 묶음 기둥 방향을 성부에 맞춘다
      if (pl.notes.length > 0) beams.push(...Beam.generateBeams(pl.notes, { groups: [beat], ...(lane.count > 1 ? { stemDirection: lane.v === 0 ? 1 : -1 } : {}) }).map((b) => (b.setStyle({ fillStyle: ink.text, strokeStyle: ink.text }), b)));
      pl.voice.draw(ctx, staves[lane.r]!);
    }
    for (const b of beams) b.setContext(ctx).draw();
    for (const pl of perLane) for (const tp of pl.tuplets) tp.setStyle({ fillStyle: ink.text, strokeStyle: ink.text }).setContext(ctx).draw();
    // 시간 → x (모든 단 음 자리, 시간 순으로 하나씩)
    const pts = new Map<number, number>();
    for (const { lane, notes, items } of perLane) {
      items.forEach((item, k) => {
        const note = notes[k]!;
        const at = toFloat(item.start);
        const nx = note.getAbsoluteX() + left;
        if (!pts.has(at)) pts.set(at, nx);
        if (item.noteId) {
          const box = note.getBoundingBox();
          hits.push({ x0: box.getX() + left - 2, x1: box.getX() + box.getW() + left + 2, y0: box.getY() - 2, y1: box.getY() + box.getH() + 2, trackId: lanes[lane]!.trackId, noteId: item.noteId });
        }
      });
    }
    anchors.set(
      i,
      [...pts.entries()].sort((a, b) => a[0] - b[0]).map(([at, nx]) => ({ at, x: nx })),
    );
    // 마디 번호
    ctx.save();
    ctx.setFont("sans-serif", 10);
    ctx.setFillStyle(ink.muted);
    ctx.fillText(String(bar.number), x + 3, rowY(0) + 30);
    ctx.restore();
  }

  // 붙임줄 (그린 범위 밖으로 이어지면 반쪽만). 화음은 모든 머리를 잇는다
  lanes.forEach((lane, li) => {
    const seq: StaffItem[] = [];
    for (let i = first; i <= last; i++) {
      const m = lane.view.measures[i];
      if (m && !m.fullRest) seq.push(...m.items);
    }
    const before = first > 0 ? lane.view.measures[first - 1] : undefined;
    const tiedIn = !!before && !before.fullRest && before.items.at(-1)?.tie === true;
    const map = drawn[li]!;
    const idx = (item: StaffItem) => Array.from({ length: 1 + (item.chord?.length ?? 0) }, (_, k) => k);
    const style = { fillStyle: ink.text, strokeStyle: ink.text };
    if (tiedIn && seq[0] && map.get(seq[0])) new StaveTie({ lastNote: map.get(seq[0])!, lastIndexes: idx(seq[0]) }).setStyle(style).setContext(ctx).draw();
    seq.forEach((item, k) => {
      if (!item.tie || !map.get(item)) return;
      const next = seq[k + 1];
      const nextNote = next ? map.get(next) : undefined;
      // 다음 조각이 이어지지 않으면(빈 마디가 끼었거나 범위 밖) 반쪽만
      const joined = next && !next.rest && Math.abs(toFloat(next.start) - (toFloat(item.start) + toFloat(item.dur))) < 1e-9;
      new StaveTie(joined && nextNote ? { firstNote: map.get(item)!, lastNote: nextNote, firstIndexes: idx(item), lastIndexes: idx(next) } : { firstNote: map.get(item)!, firstIndexes: idx(item) })
        .setStyle(style)
        .setContext(ctx)
        .draw();
    });
  });

  // 템포 (맨 위 단 위)
  ctx.save();
  ctx.setFont("sans-serif", 12, "bold");
  for (let i = first; i <= last; i++) {
    for (const mark of bars[i]!.tempo) {
      const at = toFloat(mark.at);
      const pts = anchors.get(i) ?? [];
      const hit = pts.find((p) => Math.abs(p.at - at) < 1e-9);
      const tx = (hit ? hit.x : place.left[i]! + ((at - toFloat(bars[i]!.start)) / (toFloat(bars[i]!.end) - toFloat(bars[i]!.start))) * place.width[i]!) - left;
      ctx.fillText(`♩ = ${Math.round(mark.bpm * 100) / 100}`, Math.max(2, tx), STAFF_TOP - 6);
    }
  }
  ctx.restore();
  return { anchors, hits };
}

/** 맨 앞 칸: 트랙 이름(트랙 색)과 음자리표. 스크롤해도 왼쪽에 붙어 있는 칸에 그린다 */
export function drawGutter(vf: VexFlowModule, host: HTMLElement, rows: readonly StaffRow[], width: number, ink: StaffInk): void {
  const { Renderer, Stave, BarlineType, StaveConnector } = vf;
  host.replaceChildren();
  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, rowY(rows.length) + 8);
  const ctx = renderer.getContext();
  ctx.setFillStyle(ink.text);
  ctx.setStrokeStyle(ink.text);
  // 큰보표 중괄호 자리 (단 왼쪽 바깥에 그려진다)
  const pad = rows.some((row) => row.braceDown) ? 14 : 0;
  const staves = rows.map((row, r) => {
    const stave = new Stave(pad, rowY(r), width - pad);
    stave.setBegBarType(BarlineType.SINGLE).setEndBarType(BarlineType.NONE).addClef(row.clef, "default", row.octave);
    // 줄은 옅게, 음자리표는 음표 색으로 (본문 조각과 같은 규칙)
    stave.setStyle({ strokeStyle: ink.line, fillStyle: ink.line });
    for (const mod of stave.getModifiers(vf.StaveModifierPosition.BEGIN, vf.Clef.CATEGORY)) mod.setStyle({ fillStyle: ink.text, strokeStyle: ink.text });
    stave.setContext(ctx).drawWithStyle();
    ctx.save();
    ctx.setFont("sans-serif", 11, "bold");
    ctx.setFillStyle(row.color);
    ctx.fillText(row.name.length > 10 ? row.name.slice(0, 9) + "…" : row.name, 4, rowY(r) + 26);
    ctx.restore();
    return stave;
  });
  rows.forEach((row, r) => {
    const below = staves[r + 1];
    if (!row.braceDown || !below) return;
    for (const type of ["brace", "singleLeft"] as const) {
      new StaveConnector(staves[r]!, below).setType(type).setStyle({ fillStyle: ink.text, strokeStyle: ink.line }).setContext(ctx).drawWithStyle();
    }
  });
}
