import { add, cmp, toFloat, type Note, type Rat, type TabEvent } from "@mmlce/core";
import { fretBoxLeft } from "./tabEvents";

/**
 * &로 이은 음. 같은 높이면 이어 울림(hold: 뒷자리에 괄호 숫자와 호), 다른 높이면 슬라이드(slide: / \ 선).
 * from은 화면에 숫자로 쓰는 앞 음(같은 높이로 여러 번 이었으면 맨 처음 음), to는 이어 받는 뒤 음
 */
export type TieLink =
  | { readonly kind: "hold"; readonly from: string; readonly to: string; readonly prev: Rat; readonly at: Rat }
  | { readonly kind: "slide"; readonly from: string; readonly to: string; readonly up: boolean };

/** 트랙마다 &로 이은 음 짝 (시작 순으로 훑는다) */
export function tieLinks(tracks: readonly (readonly Note[])[]): TieLink[] {
  const out: TieLink[] = [];
  for (const track of tracks) {
    const notes = [...track].sort((a, b) => cmp(a.start, b.start));
    let head: string | undefined;
    notes.forEach((n, i) => {
      head ??= n.id;
      const next = notes[i + 1];
      if (n.tie !== "next" || !next || cmp(add(n.start, n.dur), next.start) !== 0) {
        head = undefined;
        return;
      }
      if (next.pitch === n.pitch) out.push({ kind: "hold", from: head, to: next.id, prev: n.start, at: next.start });
      else {
        out.push({ kind: "slide", from: head, to: next.id, up: next.pitch > n.pitch });
        head = next.id;
      }
    });
  }
  return out;
}

/** 줄 배정에 넣을 음: 같은 높이로 &한 뒷음(이어 울림)은 다시 치지 않으므로 뺀다. 시작 순으로 앞 음을 본다 */
export function struckNotes(notes: readonly Note[]): Note[] {
  const out: Note[] = [];
  let prev: Note | undefined;
  for (const n of [...notes].sort((a, b) => cmp(a.start, b.start))) {
    const held = prev?.tie === "next" && prev.pitch === n.pitch && cmp(add(prev.start, prev.dur), n.start) === 0;
    if (!held) out.push(n);
    prev = n;
  }
  return out;
}

/** 줄 위에 쓰는 프렛 숫자 칸 하나. 슬라이드로 너무 붙은 음은 "7\6\5"처럼 한 칸에 모은다(ids가 여럿) */
export interface FretMark {
  readonly string: number;
  readonly t: number;
  readonly left: number;
  /** 배경 네모 폭 (글자 폭 + 4) */
  readonly width: number;
  readonly text: string;
  readonly ids: readonly string[];
}

/**
 * 이어 울림 표시 "(5)" 하나. arc면 앞 음 숫자에서 호를 긋는다. 앞 표시와 너무 붙어 호를 그을 자리가 없으면
 * 호 없이 앞 표시 바로 오른쪽에 쓴다 (예전에는 아예 건너뛰어, 16분음표 뒤에 &로 이은 긴 음이 타브에서 사라졌다).
 * 같은 사슬에서 이미 쓴 괄호와도 붙어 있으면 새로 쓰지 않고 그 괄호가 함께 맡는다(ids가 여럿)
 */
export interface HoldMark {
  readonly string: number;
  readonly left: number;
  readonly width: number;
  readonly text: string;
  readonly ids: readonly string[];
  /** 호를 그을 때 시작(앞 숫자 가운데)과 끝(괄호 가운데) */
  readonly arc?: { readonly from: number; readonly to: number };
}

/** 칠 수 없는 음 × 표시. ids는 그 자리에서 친 음과, 그 음에 같은 높이로 이어 울리는 뒷음 */
export interface MissingMark {
  readonly t: number;
  readonly count: number;
  readonly ids: readonly string[];
}

export interface TabMarks {
  readonly frets: readonly FretMark[];
  readonly holds: readonly HoldMark[];
  readonly missing: readonly MissingMark[];
  /** 줄에 놓인 음 id → 줄·프렛·시작(온음표 단위 실수) */
  readonly placed: ReadonlyMap<string, { readonly string: number; readonly fret: number; readonly t: number }>;
  /** 덩어리 글자로 모아 써서 따로 선을 긋지 않는 슬라이드 (닿는 음 id) */
  readonly grouped: ReadonlySet<string>;
}

/**
 * 타브에 쓸 숫자·이어 울림·× 자리. 그리는 쪽(TabView)과 테스트가 함께 쓴다: 곡의 모든 음이 이 가운데 하나로 보인다.
 * x는 시간(온음표 단위 실수) → 가로 px, textWidth는 글자 폭, tight는 이보다 가까운 두 숫자를 붙어 있다고 보는 px.
 * [from, to] 시간 밖의 숫자·괄호는 만들지 않는다 (화면 밖). 그리는 순서는 괄호 다음 숫자다: 친 음 숫자가 늘 위에 보인다.
 * labelOf가 글자를 주는 음은 프렛 숫자 대신 그 글자로 쓴다 (실험실 하모닉스 "<12>")
 */
export function layoutTabMarks(
  events: readonly TabEvent[],
  links: readonly TieLink[],
  x: (t: number) => number,
  textWidth: (text: string) => number,
  tight: number,
  from = -Infinity,
  to = Infinity,
  labelOf?: (note: Note, at: { readonly string: number; readonly fret: number }) => string | undefined,
): TabMarks {
  const placed = new Map<string, { string: number; fret: number; t: number }>();
  /** 음 id → 숫자 칸에 쓸 글자 (보통은 프렛 숫자) */
  const label = new Map<string, string>();
  for (const e of events)
    for (const { note, at } of e.notes) {
      if (!at) continue;
      placed.set(note.id, { ...at, t: toFloat(e.start) });
      label.set(note.id, labelOf?.(note, at) ?? String(at.fret));
    }
  const slideFrom = new Map<string, string>();
  for (const l of links) if (l.kind === "slide") slideFrom.set(l.to, l.from);

  const grouped = new Set<string>();
  const byString = new Map<number, { id: string; fret: number; t: number }[]>();
  for (const [id, p] of placed) {
    if (p.t < from - 0.5 || p.t > to) continue;
    const list = byString.get(p.string) ?? [];
    list.push({ id, fret: p.fret, t: p.t });
    byString.set(p.string, list);
  }
  const frets: FretMark[] = [];
  /** 음 id → 그 음이 들어 있는 숫자 칸 */
  const boxOf = new Map<string, FretMark>();
  for (const [string, list] of byString) {
    list.sort((a, b) => a.t - b.t);
    let i = 0;
    while (i < list.length) {
      const first = list[i]!;
      let text = label.get(first.id)!;
      let j = i + 1;
      while (j < list.length) {
        const prev = list[j - 1]!;
        const cur = list[j]!;
        if (x(cur.t) - x(prev.t) >= tight || slideFrom.get(cur.id) !== prev.id) break;
        text += (cur.fret > prev.fret ? "/" : "\\") + label.get(cur.id)!;
        grouped.add(cur.id);
        j++;
      }
      const mark: FretMark = { string, t: first.t, left: fretBoxLeft(x(first.t)), width: textWidth(text) + 4, text, ids: list.slice(i, j).map((p) => p.id) };
      frets.push(mark);
      for (const p of list.slice(i, j)) boxOf.set(p.id, mark);
      i = j;
    }
  }

  // 이어 울림: 사슬(같은 from)마다 앞 표시의 오른쪽 끝을 따라간다
  const holds: { string: number; left: number; width: number; text: string; ids: string[]; arc?: { from: number; to: number }; x1: number }[] = [];
  const lastOf = new Map<string, { right: number; hold?: (typeof holds)[number] }>();
  /** 칠 수 없는 음(줄에 없는 앞 음)에 이어 울리는 뒷음 → 그 앞 음 id */
  const heldByMissing = new Map<string, string>();
  for (const l of links) {
    if (l.kind !== "hold") continue;
    const a = placed.get(l.from);
    if (!a) {
      heldByMissing.set(l.to, l.from);
      continue;
    }
    const t1 = toFloat(l.at);
    if (t1 < from - 0.5 || t1 > to) continue;
    const x0 = x(toFloat(l.prev));
    const x1 = x(t1);
    const text = `(${label.get(l.from)!})`;
    const width = textWidth(text) + 4;
    const head = boxOf.get(l.from);
    const last = lastOf.get(l.from) ?? (head ? { right: head.left + head.width } : undefined);
    if (x1 - x0 < tight && last?.hold && x1 - last.hold.x1 < tight) {
      // 바로 앞 괄호와 붙어 있다: 그 괄호가 이 음도 맡는다
      last.hold.ids.push(l.to);
      continue;
    }
    const base = fretBoxLeft(x1);
    let mark: (typeof holds)[number];
    if (x1 - x0 < tight) {
      mark = { string: a.string, left: Math.max(base, (last?.right ?? base) + 1), width, text, ids: [l.to], x1 };
    } else {
      const fromX = x(toFloat(l.prev));
      const startText = label.get(l.from)!;
      mark = {
        string: a.string,
        left: base,
        width,
        text,
        ids: [l.to],
        x1,
        arc: { from: fretBoxLeft(fromX) + 2 + textWidth(startText) / 2, to: base + width / 2 },
      };
    }
    holds.push(mark);
    lastOf.set(l.from, { right: mark.left + mark.width, hold: mark });
  }

  const missing: MissingMark[] = [];
  for (const e of events) {
    const t = toFloat(e.start);
    if (t < from - 0.1 || t > to) continue;
    const ids = e.notes.filter((n) => !n.at).map((n) => n.note.id);
    if (ids.length === 0) continue;
    const heads = new Set(ids);
    const tails = [...heldByMissing].filter(([, head]) => heads.has(head)).map(([tail]) => tail);
    missing.push({ t, count: ids.length, ids: [...ids, ...tails] });
  }
  return { frets, holds: holds.map(({ x1: _x1, ...h }) => h), missing, placed, grouped };
}
