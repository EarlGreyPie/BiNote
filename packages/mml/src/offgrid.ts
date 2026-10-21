import { add, cmp, eq, getProfile, PROFILES, rat, sub, type Command, type LengthLimit, type Rat, type Song } from "@mmlce/core";
import { parseMml } from "./parser.js";
import { setTrackText } from "./edit.js";

/**
 * 3MLE·마비꼬식 어긋난 길이 찾기.
 *
 * 3MLE·마비꼬는 길이를 정수 틱으로 버려 셈하므로 박에 맞추려고 r21(= r32.), b19.(= 5/64), l28 여섯 + l27 같은 값을 쓴 악보가 있다.
 * BiNote와 게임은 정확한 분수로 연주하므로 이런 자리부터 뒤가 조금씩 밀린다.
 * 여기서는 그런 자리를 찾아 "이렇게 고칠까요?"만 만든다. 고치는 것은 사용자가 고른 것만 (fixOffgrid).
 *
 * 규칙 (EarlGreyPie 확인 2026-10-21):
 * 1. 깔끔한 자리(OFFGRID_CLEAN 칸)에서 칸에 안 맞는 길이가 나오면 묶음을 시작한다.
 * 2. 음을 더해 가다가 위치가 정확히 깔끔한 자리로 돌아오면 진짜 잇단음이라 건드리지 않는다.
 * 3. 위치가 착지 칸(OFFGRID_LANDINGS)에서 0보다 크고 OFFGRID_TOLERANCE 이하로 비껴 있으면 후보로 본다.
 *    안 맞는 음이 하나면 그 음을 착지 칸에 딱 닿는 깔끔한 길이(한 토막 또는 두 토막)로,
 *    여럿이면 고르게 나눈 l 숫자(잇단음)로 고친다. 깔끔한 값이 안 나오면 제안하지 않는다.
 * 4. 앞 후보를 고쳤다고 치고 뒤를 계산한다 ("모두 고치기"가 서로 엇갈리지 않게).
 */

/** 허용 오차: 3MLE 1틱 (온음표의 1/384, 4분음표의 1/96). 바꾸려면 여기만 고친다 */
export const OFFGRID_TOLERANCE: Rat = rat(1, 384);
/** 착지 칸: 16분음표 자리와 셋잇단 8분음표 자리 */
export const OFFGRID_LANDINGS: readonly number[] = [16, 12];
/** 깔끔한 자리의 칸 (온음표의 1/384: l1~l64, 셋잇단, 점음표가 닿는 자리) */
export const OFFGRID_CLEAN = 384;
/** 묶음을 볼 최대 길이 (온음표) */
export const OFFGRID_WINDOW: Rat = rat(1);

/** 고칠 때 쓰는 길이 숫자 (점 2개까지). 게임 길이 한도 밖 숫자는 뺀다 */
const CLEAN_LENGTHS = [1, 2, 4, 8, 16, 32, 64, 3, 6, 12, 24, 48, 96];

export interface OffgridEdit {
  /** 트랙 원문에서 바꿀 범위 [from, to) */
  readonly span: readonly [number, number];
  readonly from: string;
  readonly to: string;
}

export interface OffgridFix {
  readonly trackId: string;
  /** single: 안 맞는 음 하나를 깔끔한 길이로, tuplet: 여러 음을 같은 길이 잇단음으로 */
  readonly kind: "single" | "tuplet";
  /** 고칠 첫 음·쉼표의 지금 곡 위치 (이동용) */
  readonly at: Rat;
  /** 고칠 첫 자리가 음이면 그 음 높이 (쉼표면 없음) */
  readonly pitch?: number | undefined;
  /** 묶음 끝 (고친 뒤 이 착지 칸에 딱 닿는다). 앞 후보를 고쳤다고 친 곡 위치 */
  readonly landing: Rat;
  /** 묶음 시작. landing과 같은 기준 */
  readonly start: Rat;
  readonly edits: readonly OffgridEdit[];
}

interface Element {
  readonly kind: "note" | "rest";
  readonly start: Rat;
  dur: Rat;
  readonly pitch?: number;
  readonly span: readonly [number, number];
}

const isClean = (x: Rat) => OFFGRID_CLEAN % x.d === 0;

/** 가장 가까운 착지 칸 중 허용 오차 안(0 제외)에 있는 것 */
function nearLanding(p: Rat): Rat | undefined {
  let best: { q: Rat; miss: Rat } | undefined;
  for (const g of OFFGRID_LANDINGS) {
    const q = rat(Math.round((p.n * g) / p.d), g);
    const diff = sub(p, q);
    const miss = diff.n < 0 ? rat(-diff.n, diff.d) : diff;
    if (miss.n === 0 || cmp(miss, OFFGRID_TOLERANCE) > 0) continue;
    if (!best || cmp(miss, best.miss) < 0) best = { q, miss };
  }
  return best?.q;
}

/** 깔끔한 한 토막 또는 두 토막 (긴 것 먼저). 점 적은 것을 먼저 고른다 */
export function cleanPieces(x: Rat, limit: LengthLimit): string[] | undefined {
  if (x.n <= 0) return undefined;
  const maxDots = Math.min(2, limit.dots);
  const table: { text: string; value: Rat; dots: number }[] = [];
  for (const n of CLEAN_LENGTHS) {
    if (n < limit.min || n > limit.max) continue;
    for (let dots = 0; dots <= maxDots; dots++) {
      // 점 하나마다 반씩 더한다: 1/n × (2 − 1/2^dots)
      table.push({ text: `${n}${".".repeat(dots)}`, value: rat(2 ** (dots + 1) - 1, n * 2 ** dots), dots });
    }
  }
  const single = table.filter((p) => eq(p.value, x)).sort((a, b) => a.dots - b.dots)[0];
  if (single) return [single.text];
  let pair: { texts: string[]; dots: number } | undefined;
  for (const a of table) {
    for (const b of table) {
      if (cmp(a.value, b.value) < 0 || !eq(add(a.value, b.value), x)) continue;
      const dots = a.dots + b.dots;
      if (!pair || dots < pair.dots) pair = { texts: [a.text, b.text], dots };
    }
  }
  return pair?.texts;
}

/** 음·쉼표 하나를 새 길이 토막들로 쓴 글. n 음표는 길이를 붙일 수 없어 undefined */
function rewrite(text: string, el: Element, pieces: readonly string[]): string | undefined {
  const written = text.slice(el.span[0], el.span[1]);
  if (el.kind === "rest") return pieces.map((p) => `${written[0]}${p}`).join("");
  const pitch = /^[a-g][+#-]*/i.exec(written)?.[0];
  if (!pitch) return undefined;
  return pieces.map((p) => pitch + p).join("&");
}

/**
 * 트랙 원문 하나에서 고칠 자리를 찾는다. offset은 원문 앞에 붙는 시작 위치 (마비꼬 startDelta).
 * 서로소 길이가 쌓여 분수가 너무 커지면 그 트랙은 찾지 않는다
 */
export function findTrackOffgrid(text: string, limit: LengthLimit, offset?: Rat): Omit<OffgridFix, "trackId">[] {
  const parsed = parseMml(text);
  const els: Element[] = [
    ...parsed.notes.map((n) => ({ kind: "note" as const, start: n.start, dur: n.dur, pitch: n.pitch, span: n.span })),
    ...parsed.rests.map((r) => ({ kind: "rest" as const, start: r.start, dur: r.dur, span: r.span })),
  ].sort((a, b) => a.span[0] - b.span[0]);
  const base = offset ?? rat(0);
  const out: Omit<OffgridFix, "trackId">[] = [];
  try {
    // shift: 고칠 수 없이 밀린 뒤에는 밀린 만큼을 빼고 본다 (그 뒤 자리도 찾을 수 있게)
    let pos = base;
    let shift = rat(0);
    let i = 0;
    while (i < els.length) {
      const here = sub(pos, shift);
      if (!isClean(here) || isClean(els[i]!.dur)) {
        pos = add(pos, els[i]!.dur);
        i++;
        continue;
      }
      const found = scan(els, i, here, limit, text);
      if (found === "exact") {
        // 진짜 잇단음: 돌아온 자리까지 그대로 넘긴다
        let j = i;
        let p = here;
        while (!isClean(p) || j === i) {
          p = add(p, els[j]!.dur);
          pos = add(pos, els[j]!.dur);
          j++;
        }
        i = j;
        continue;
      }
      if (found) {
        out.push({ ...found.fix, at: add(base, els[found.first]!.start) });
        for (const [k, dur] of found.durs) els[k]!.dur = dur;
        // 고친 길이로 같은 자리부터 다시 본다
        continue;
      }
      // 고칠 값이 없다: 이 음 뒤 자리를 새 기준으로 삼는다
      pos = add(pos, els[i]!.dur);
      const after = sub(pos, shift);
      const g = OFFGRID_CLEAN;
      shift = add(shift, sub(after, rat(Math.round((after.n * g) / after.d), g)));
      i++;
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return out;
  }
  return out;
}

/** i번 요소에서 시작하는 묶음을 본다. 정확히 돌아오면 "exact", 고칠 값이 있으면 그 고침 */
function scan(
  els: readonly Element[],
  i: number,
  start: Rat,
  limit: LengthLimit,
  text: string,
): "exact" | { fix: Omit<OffgridFix, "trackId" | "at">; first: number; durs: [number, Rat][] } | undefined {
  // 묶음 안에서 한 번이라도 정확히 돌아오면 진짜 잇단음이다 (그 앞에 비슷하게 닿는 자리가 있어도)
  let p = start;
  for (let j = i; j < els.length; j++) {
    p = add(p, els[j]!.dur);
    if (cmp(sub(p, start), OFFGRID_WINDOW) > 0) break;
    if (isClean(p)) return "exact";
  }
  p = start;
  for (let j = i; j < els.length; j++) {
    p = add(p, els[j]!.dur);
    if (cmp(sub(p, start), OFFGRID_WINDOW) > 0) return undefined;
    const q = nearLanding(p);
    if (!q) continue;
    const group = els.slice(i, j + 1).map((el, k) => ({ el, k: i + k }));
    const odd = group.filter((g) => !isClean(g.el.dur));
    const even = group.filter((g) => isClean(g.el.dur)).reduce((s, g) => add(s, g.el.dur), rat(0));
    const room = sub(sub(q, start), even);
    if (room.n <= 0) continue;
    if (odd.length === 1) {
      const target = odd[0]!;
      const pieces = cleanPieces(room, limit);
      const to = pieces && rewrite(text, target.el, pieces);
      if (!to) continue;
      return {
        fix: { kind: "single", pitch: target.el.pitch, start, landing: q, edits: [{ span: target.el.span, from: text.slice(...target.el.span), to }] },
        first: target.k,
        durs: [[target.k, room]],
      };
    }
    // 여럿: 고르게 나눈 값이 l 숫자로 딱 떨어지고 게임 한도 안일 때만
    const each = rat(room.n, room.d * odd.length);
    if (each.n !== 1 || each.d < limit.min || each.d > limit.max) continue;
    const changed = odd.filter((g) => !eq(g.el.dur, each));
    const edits: OffgridEdit[] = [];
    for (const g of changed) {
      const to = rewrite(text, g.el, [String(each.d)]);
      if (!to) break;
      edits.push({ span: g.el.span, from: text.slice(...g.el.span), to });
    }
    if (edits.length !== changed.length || edits.length === 0) continue;
    return {
      fix: { kind: "tuplet", pitch: changed[0]!.el.pitch, start, landing: q, edits },
      first: changed[0]!.k,
      durs: odd.map((g) => [g.k, each]),
    };
  }
  return undefined;
}

/** 곡 전체에서 고칠 자리. 원문이 있는 트랙만 본다 (원문 없는 트랙은 BiNote가 쓴 글이라 칸에 맞다) */
export function findOffgrid(song: Song): OffgridFix[] {
  const limit = (PROFILES[song.meta.profileId] ?? getProfile("mobile")).length;
  return song.tracks.flatMap((t) => (t.mml ? findTrackOffgrid(t.mml.text, limit, t.mml.offset).map((f) => ({ ...f, trackId: t.id })) : []));
}

/** 글 범위 고치기 (뒤에서부터 바꿔 앞 범위가 밀리지 않게) */
function splice(text: string, edits: readonly OffgridEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.span[0] - a.span[0])) {
    if (out.slice(e.span[0], e.span[1]) !== e.from) return text;
    out = out.slice(0, e.span[0]) + e.to + out.slice(e.span[1]);
  }
  return out;
}

/** 고른 자리들을 고친다. 실행 취소 한 번에 모두 돌아간다. 트랙 템포 지도는 원문 편집(setTrackText)과 같이 따라간다 */
export function fixOffgrid(fixes: readonly OffgridFix[], label = "어긋난 길이 고치기"): Command {
  const command: Command = {
    label,
    apply(song) {
      let next = song;
      const byTrack = new Map<string, OffgridEdit[]>();
      for (const f of fixes) byTrack.set(f.trackId, [...(byTrack.get(f.trackId) ?? []), ...f.edits]);
      for (const [trackId, edits] of byTrack) {
        const track = next.tracks.find((t) => t.id === trackId);
        if (!track?.mml) continue;
        const text = splice(track.mml.text, edits);
        if (text !== track.mml.text) next = setTrackText(trackId, text).apply(next);
      }
      return next;
    },
    invert: (before) => ({ label, apply: () => before, invert: () => command }),
  };
  return command;
}
