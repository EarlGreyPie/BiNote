import { staffPitch, toFloat, type StaffBar, type StaffItem, type StaffTrack } from "@mmlce/core";
import { STAFF_ROW, STAFF_TOP, type TimeAnchors } from "./staffLayout";

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

export interface StaffRow {
  readonly trackId: string;
  readonly name: string;
  readonly color: string;
  readonly view: StaffTrack;
}

export interface StaffInk {
  readonly text: string;
  readonly muted: string;
  /** 박자 밖이라 그리기용으로 맞춘 음 */
  readonly approx: string;
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

/** 쉼표를 둘 줄 (오선 가운데) */
const restKey = (clef: "treble" | "bass") => (clef === "bass" ? "d/3" : "b/4");

function keyOf(item: StaffItem, clef: "treble" | "bass"): string {
  if (item.pitch === undefined) return restKey(clef);
  const p = staffPitch(item.pitch);
  return `${p.letter}${p.sharp ? "#" : ""}/${p.octave}`;
}

/** 오선 한 단의 위 끝 (트랙 순서 r) */
export const rowY = (r: number) => STAFF_TOP + r * STAFF_ROW;

/**
 * [first, last] 마디를 host 안에 그린다 (host는 offsets[first] 자리에 놓인 칸). 앞 그림은 지운다.
 * offsets·widths는 staffLayout에서 정한 마디 자리·폭
 */
export function drawStaff(
  vf: VexFlowModule,
  host: HTMLElement,
  bars: readonly StaffBar[],
  offsets: readonly number[],
  widths: readonly number[],
  rows: readonly StaffRow[],
  range: readonly [number, number],
  ink: StaffInk,
): StaffDrawn {
  const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Tuplet, StaveTie, Accidental, Dot, Annotation, Fraction } = vf;
  host.replaceChildren();
  const [first, last] = range;
  const left = offsets[first]!;
  const width = offsets[last + 1]! - left + 2;
  const height = rowY(rows.length) + 8;
  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  ctx.setFillStyle(ink.text);
  ctx.setStrokeStyle(ink.text);

  const anchors = new Map<number, TimeAnchors>();
  const hits: StaffHit[] = [];
  // 트랙마다 그린 음 (붙임줄을 마디 너머로 잇는다)
  const drawn = rows.map(() => new Map<StaffItem, InstanceType<typeof StaveNote>>());

  for (let i = first; i <= last; i++) {
    const bar = bars[i]!;
    const x = offsets[i]! - left;
    const w = widths[i]!;
    const voices: InstanceType<typeof Voice>[] = [];
    const staves: InstanceType<typeof Stave>[] = [];
    const perRow: { notes: InstanceType<typeof StaveNote>[]; items: readonly StaffItem[]; tuplets: InstanceType<typeof Tuplet>[] }[] = [];
    const beat = bar.unit === 8 && bar.beats > 3 && bar.beats % 3 === 0 ? new Fraction(3, 8) : new Fraction(1, bar.unit);
    rows.forEach((row, r) => {
      const stave = new Stave(x, rowY(r), w);
      if (bar.showSig) stave.addTimeSignature(`${bar.beats}/${bar.unit}`);
      stave.setContext(ctx).draw();
      staves.push(stave);
      const m = row.view.measures[i];
      const clef = row.view.clef;
      const items = m && !m.fullRest ? m.items : [];
      const notes = items.map((item) => {
        const note = new StaveNote({ keys: [keyOf(item, clef)], duration: DURATION[item.base] + (item.rest ? "r" : ""), dots: item.dots, clef, autoStem: true });
        // 점은 하나씩 붙는다 (겹점음표는 두 번)
        for (let d = 0; d < item.dots; d++) Dot.buildAndAttach([note], { all: true });
        if (item.accidental) note.addModifier(new Accidental(item.accidental), 0);
        if (item.dynamic) note.addModifier(new Annotation(item.dynamic).setFont("Academico", 13, "bold", "italic").setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0);
        if (item.approx) note.setStyle({ fillStyle: ink.approx, strokeStyle: ink.approx });
        note.setStave(stave);
        drawn[r]!.set(item, note);
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
        const rest = new StaveNote({ keys: [restKey(clef)], duration: "wr", clef, alignCenter: true });
        rest.setStave(stave);
        voice.addTickables([rest]);
      } else voice.addTickables(notes);
      voices.push(voice);
      perRow.push({ notes, items, tuplets });
    });
    const noteStart = Math.max(...staves.map((s) => s.getNoteStartX())) - x;
    // 트랙들을 함께 맞춰 같은 시간의 음이 위아래로 줄 서게 한다
    // joinVoices: 임시표·점·셈여림 자리(ModifierContext)를 만든다 (format만으로는 만들지 않는다)
    new Formatter().joinVoices(voices).format(voices, Math.max(20, w - noteStart - 12));
    const beams: InstanceType<typeof Beam>[] = [];
    voices.forEach((voice, r) => {
      const notes = perRow[r]!.notes;
      if (notes.length > 0) beams.push(...Beam.generateBeams(notes, { groups: [beat] }));
      voice.draw(ctx, staves[r]!);
    });
    for (const b of beams) b.setContext(ctx).draw();
    for (const row of perRow) for (const tp of row.tuplets) tp.setContext(ctx).draw();
    // 시간 → x (모든 트랙 음 자리, 시간 순으로 하나씩)
    const pts = new Map<number, number>();
    perRow.forEach(({ notes, items }, r) => {
      items.forEach((item, k) => {
        const note = notes[k]!;
        const at = toFloat(item.start);
        const nx = note.getAbsoluteX() + left;
        if (!pts.has(at)) pts.set(at, nx);
        if (item.noteId) {
          const box = note.getBoundingBox();
          hits.push({ x0: box.getX() + left - 2, x1: box.getX() + box.getW() + left + 2, y0: box.getY() - 2, y1: box.getY() + box.getH() + 2, trackId: rows[r]!.trackId, noteId: item.noteId });
        }
      });
    });
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

  // 붙임줄 (그린 범위 밖으로 이어지면 반쪽만)
  rows.forEach((row, r) => {
    const seq: StaffItem[] = [];
    for (let i = first; i <= last; i++) {
      const m = row.view.measures[i];
      if (m && !m.fullRest) seq.push(...m.items);
    }
    const before = first > 0 ? row.view.measures[first - 1] : undefined;
    const tiedIn = !!before && !before.fullRest && before.items.at(-1)?.tie === true;
    const map = drawn[r]!;
    if (tiedIn && seq[0]) new StaveTie({ lastNote: map.get(seq[0])!, lastIndexes: [0] }).setContext(ctx).draw();
    seq.forEach((item, k) => {
      if (!item.tie) return;
      const next = seq[k + 1];
      const nextNote = next ? map.get(next) : undefined;
      // 다음 조각이 이어지지 않으면(빈 마디가 끼었거나 범위 밖) 반쪽만
      const joined = next && !next.rest && Math.abs(toFloat(next.start) - (toFloat(item.start) + toFloat(item.dur))) < 1e-9;
      new StaveTie(joined && nextNote ? { firstNote: map.get(item)!, lastNote: nextNote, firstIndexes: [0], lastIndexes: [0] } : { firstNote: map.get(item)!, firstIndexes: [0] })
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
      const tx = (hit ? hit.x : offsets[i]! + ((at - toFloat(bars[i]!.start)) / (toFloat(bars[i]!.end) - toFloat(bars[i]!.start))) * widths[i]!) - left;
      ctx.fillText(`♩ = ${Math.round(mark.bpm * 100) / 100}`, Math.max(2, tx), STAFF_TOP - 6);
    }
  }
  ctx.restore();
  return { anchors, hits };
}

/** 맨 앞 칸: 트랙 이름(트랙 색)과 음자리표. 스크롤해도 왼쪽에 붙어 있는 칸에 그린다 */
export function drawGutter(vf: VexFlowModule, host: HTMLElement, rows: readonly StaffRow[], width: number, ink: StaffInk): void {
  const { Renderer, Stave, BarlineType } = vf;
  host.replaceChildren();
  const renderer = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, rowY(rows.length) + 8);
  const ctx = renderer.getContext();
  ctx.setFillStyle(ink.text);
  ctx.setStrokeStyle(ink.text);
  rows.forEach((row, r) => {
    const stave = new Stave(0, rowY(r), width);
    stave.setBegBarType(BarlineType.SINGLE).setEndBarType(BarlineType.NONE).addClef(row.view.clef);
    stave.setContext(ctx).draw();
    ctx.save();
    ctx.setFont("sans-serif", 11, "bold");
    ctx.setFillStyle(row.color);
    ctx.fillText(row.name.length > 10 ? row.name.slice(0, 9) + "…" : row.name, 4, rowY(r) + 26);
    ctx.restore();
  });
}
