import { add, cmp, eq, getProfile, isGameLength, normalizeTempo, noteLengthValue, PROFILES, rat, sub, toFloat, type Command, type LengthLimit, type Rat, type Song } from "@mmlce/core";
import { parseMml } from "./parser.js";
import { parseTrackText, setTrackText } from "./edit.js";

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
 *    다만 그보다 먼저 3의 후보 자리를 지나면 후보로 본다 (2026-10-22: `c9 c+64`처럼 l9 셋이 모여 1/3로 돌아오는 바람에
 *    앞의 c9가 잇단음으로 잘못 보이던 것. l20·l28·l40처럼 한 숫자 잇단음은 돌아오기 전에 후보 자리에 닿지 않는다).
 * 3. 위치가 착지 칸(OFFGRID_LANDINGS)에서 0보다 크고 허용 오차 이하로 비껴 있으면 후보로 본다.
 *    16분 칸은 허용 오차를 안 맞는 길이의 점 수만큼 더 준다 (3MLE는 점마다 한 번 더 버려 r14.·r5.는 1틱 넘게 빗나간다).
 *    이 늘린 오차는 끝내 정확히 돌아오지 않는 묶음에만 쓴다 (점 붙은 잇단음 l44.·l20.은 그대로 둔다).
 *    셋잇단 칸은 늘 1틱 (늘리면 b19.이 b12로 잘못 잡힌다).
 *    안 맞는 음이 하나면 그 음을 착지 칸에 딱 닿는 깔끔한 길이(한 토막 또는 두 토막)로,
 *    여럿이면 고르게 나눈 l 숫자(잇단음)로 고친다. 깔끔한 값이 안 나오면 제안하지 않는다.
 * 4. 앞 후보를 고쳤다고 치고 뒤를 계산한다 ("모두 고치기"가 서로 엇갈리지 않게).
 * 5. 제안 대신 사용자가 길이를 직접 적을 수 있다 (customOffgrid). 그때는 묶음 끝이 제안보다 얼마나 비껴가는지 보여 준다.
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

/** 가장 가까운 착지 칸 중 허용 오차 안(0 제외)에 있는 것. dots: 묶음의 안 맞는 길이에 붙은 점 수 (16분 칸 허용 오차만 늘린다) */
function nearLanding(p: Rat, dots: number): Rat | undefined {
  let best: { q: Rat; miss: Rat } | undefined;
  for (const g of OFFGRID_LANDINGS) {
    const q = rat(Math.round((p.n * g) / p.d), g);
    const diff = sub(p, q);
    const miss = diff.n < 0 ? rat(-diff.n, diff.d) : diff;
    const tolerance = g === 16 ? rat(OFFGRID_TOLERANCE.n * (1 + dots), OFFGRID_TOLERANCE.d) : OFFGRID_TOLERANCE;
    if (miss.n === 0 || cmp(miss, tolerance) > 0) continue;
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
  // 정확히 돌아오면 진짜 잇단음이다. 그보다 먼저 후보 자리에 닿아 고칠 값이 나오면 그것.
  // 다만 점 수만큼 늘린 허용 오차는 끝내 정확히 돌아오지 않는 묶음에만 쓴다: 점 붙은 잇단음(l44. 열하나, l20. 다섯)은
  // 점이 쌓이며 늘어난 오차 안에 가운데 자리가 들어와, 정확한 잇단음을 고치자고 하게 된다
  let p = start;
  let returns = false;
  for (let j = i; j < els.length; j++) {
    p = add(p, els[j]!.dur);
    if (cmp(sub(p, start), OFFGRID_WINDOW) > 0) break;
    if (isClean(p)) {
      returns = true;
      break;
    }
  }
  p = start;
  let dots = 0;
  for (let j = i; j < els.length; j++) {
    p = add(p, els[j]!.dur);
    if (cmp(sub(p, start), OFFGRID_WINDOW) > 0) return undefined;
    if (isClean(p)) return "exact";
    if (!isClean(els[j]!.dur)) dots += (text.slice(...els[j]!.span).match(/\./g) ?? []).length;
    const q = nearLanding(p, returns ? 0 : dots);
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
    // 여럿이 바로 붙은 쉼표(r5.r9)나 같은 음 붙임(b5.&b9)이면 한 덩어리로 보고 깔끔한 토막으로 다시 쓴다
    const joined = joinedRewrite(text, odd.map((g) => g.el), room, limit);
    if (joined) {
      return {
        fix: { kind: "single", pitch: odd[0]!.el.pitch, start, landing: q, edits: [joined] },
        first: odd[0]!.k,
        durs: odd.map((g, k) => [g.k, k === 0 ? room : rat(0)]),
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

/** 바로 이어 쓴 쉼표들, 또는 &로 이은 같은 높이 음들을 room 길이 한 덩어리로 다시 쓴 고침. 아니면 undefined */
function joinedRewrite(text: string, odd: readonly Element[], room: Rat, limit: LengthLimit): OffgridEdit | undefined {
  const first = odd[0]!;
  const last = odd.at(-1)!;
  const rests = odd.every((el) => el.kind === "rest");
  const tied = odd.every((el) => el.kind === "note" && el.pitch === first.pitch);
  if (odd.length < 2 || !(rests || tied)) return undefined;
  for (let k = 1; k < odd.length; k++) {
    const gap = text.slice(odd[k - 1]!.span[1], odd[k]!.span[0]);
    if (rests ? gap !== "" : !/^\s*&\s*$/.test(gap)) return undefined;
  }
  const pieces = cleanPieces(room, limit);
  const to = pieces && rewrite(text, first, pieces);
  return to ? { span: [first.span[0], last.span[1]], from: text.slice(first.span[0], last.span[1]), to } : undefined;
}

/** 곡 프로필의 길이 한도 */
export function offgridLimit(song: Song): LengthLimit {
  return (PROFILES[song.meta.profileId] ?? getProfile("mobile")).length;
}

/** 곡 전체에서 고칠 자리. 원문이 있는 트랙만 본다 (원문 없는 트랙은 BiNote가 쓴 글이라 칸에 맞다) */
export function findOffgrid(song: Song): OffgridFix[] {
  const limit = offgridLimit(song);
  return song.tracks.flatMap((t) => {
    if (!t.mml) return [];
    const find = t.mmlDialect === "mabiicco" ? findTrackOffgridMabiicco : findTrackOffgrid;
    return find(t.mml.text, limit, t.mml.offset).map((f) => ({ ...f, trackId: t.id }));
  });
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
      return mabiiccoTempo(song, next, [...byTrack.keys()]);
    },
    invert: (before) => ({ label, apply: () => before, invert: () => command }),
  };
  return command;
}

/**
 * 마비꼬 트랙을 고친 뒤의 곡 템포 지도.
 * 마비꼬는 템포를 tempo= 줄과 첫 파트 글에 같이 쓰고, 다른 파트(둘째 mml-track의 첫 칸 등)에도 같은 템포를 되풀이해 적는데,
 * 셋 다 자기 길이 어긋남만큼 서로 다른 자리에 있다. 그래서 원문을 고치며 템포를 그대로 따라가게 두면
 * 옛 자리와 새 자리 템포가 같이 남는다 (Blackbird: 48개가 80개로).
 * 곡 템포와 빠르기 순서가 같은 템포를 가진 마비꼬 트랙(템포를 실은 트랙)을 고쳤으면 그 트랙의 고친 글 자리로 옮기고,
 * 아니면 템포 지도는 고치기 전 그대로 둔다
 */
function mabiiccoTempo(before: Song, after: Song, edited: readonly string[]): Song {
  const mabiicco = (id: string) => before.tracks.find((t) => t.id === id)?.mmlDialect === "mabiicco";
  if (!edited.some(mabiicco)) return after;
  const bpms = before.tempo.map((e) => e.bpm).join(",");
  const carrier = before.tracks.find((t) => t.mml && t.mmlDialect === "mabiicco" && parseTrackText(t.id, t.mml).tempo.map((e) => e.bpm).join(",") === bpms);
  const fixed = carrier && edited.includes(carrier.id) ? after.tracks.find((t) => t.id === carrier.id)?.mml : undefined;
  const moved = fixed ? normalizeTempo(parseTrackText(carrier!.id, fixed).tempo) : undefined;
  return { ...after, tempo: moved && moved.length === before.tempo.length ? moved : before.tempo };
}

/**
 * 사용자가 적은 길이 (`32.`, `r32.`, `16&64`, `b16&b64`, `r16r64`) → 길이 토막과 합. 음 이름·r은 있어도 없어도 된다.
 * 토막마다 숫자가 있어야 하고(l 기본 길이는 자리마다 달라 쓰지 않는다) 게임 길이 한도 안이어야 한다. 아니면 undefined
 */
export function parseOffgridLength(input: string, limit: LengthLimit): { pieces: string[]; value: Rat } | undefined {
  const chunks = input.trim().split("&").map((p) => p.trim());
  if (chunks.some((p) => p === "")) return undefined;
  const parts = chunks.flatMap((p) => p.split(/(?=[a-gr])/i)).filter((p) => p !== "");
  const pieces: string[] = [];
  let value = rat(0);
  for (const part of parts) {
    const m = /^(?:[a-g][+#-]*|r)?(\d+)(\.*)$/i.exec(part);
    if (!m) return undefined;
    const length = Number(m[1]);
    const dots = m[2]!.length;
    if (!isGameLength(limit, length, dots)) return undefined;
    pieces.push(`${length}${m[2]}`);
    value = add(value, noteLengthValue(length, dots));
  }
  return { pieces, value };
}

/** 묶음 안 자리마다 고칠 길이가 다른 고침 (마비꼬 트랙의 r4.r7 + c8&c9 등). 길이 하나를 적어 모두에 쓸 수 없다 */
export function offgridMixed(fix: OffgridFix): boolean {
  return new Set(fix.edits.map(offgridLengthText)).size > 1;
}

/** 제안한 고칠 값의 길이만 (`b16&b64` → `16&64`, `r32.` → `32.`). 입력 칸의 처음 값 */
export function offgridLengthText(edit: OffgridEdit): string {
  return (edit.to.match(/\d+\.*/g) ?? []).join("&");
}

/** 사용자 길이로 쓴 고침의 결과: 고칠 글, 묶음 끝이 제안보다 늦는(+)·이른(−) 만큼, 그 끝이 깔끔한 칸인지 */
export interface CustomOffgrid {
  readonly fix: OffgridFix;
  readonly miss: Rat;
  readonly clean: boolean;
}

/**
 * 제안 대신 사용자가 적은 길이로 고친다. 고칠 음·쉼표마다 같은 길이를 쓴다 (잇단음 묶음이면 바꾸는 음 모두).
 * 길이를 쓸 수 없으면 undefined. 뒤 자리는 고친 뒤 곡에서 다시 찾으므로, 어긋나게 고치면 뒤에 새 자리가 나올 수 있다
 */
export function customOffgrid(fix: OffgridFix, input: string, limit: LengthLimit): CustomOffgrid | undefined {
  const custom = parseOffgridLength(input, limit);
  if (!custom || offgridMixed(fix)) return undefined;
  let miss = rat(0);
  const edits: OffgridEdit[] = [];
  for (const e of fix.edits) {
    const suggested = parseOffgridLength(offgridLengthText(e), { min: 1, max: 1 << 20, dots: 8 });
    if (!suggested) return undefined;
    const head = /^(?:[a-g][+#-]*|[r])/i.exec(e.from)?.[0];
    if (!head) return undefined;
    const rest = head.toLowerCase() === "r";
    edits.push({ ...e, to: custom.pieces.map((p) => head + p).join(rest ? "" : "&") });
    miss = add(miss, sub(custom.value, suggested.value));
  }
  return { fix: { ...fix, edits }, miss, clean: isClean(add(fix.landing, miss)) };
}

/*
 * ── 마비꼬 .mmi에서 읽은 트랙 ──
 *
 * 마비꼬는 길이를 4분음표 96틱 정수로 버려 들고 있다가, .mmi에 쓸 때 그 틱을 숫자 하나(N ≒ 384 / 틱)로 다시 적는다.
 * 그래서 칸에 안 맞는 길이가 원래 값에서 1틱 안쪽씩 바뀐다 (2026-11-01 Blackbird 원본·.mmi·.mme 비교로 확인):
 *   e32.(18틱) → e21, 16분 점+64분(42틱) → 9, l28 → l29, l36 → l38, l40 → l42. l20·l10·l27은 그대로.
 * 위 규칙(가까운 착지 칸 하나에 맞추기)은 이런 숫자가 몰린 잇단음 묶음에서 틀린 값을 낸다
 * (l42 둘 + l20 + l10 넷 = 2분음표를 l14 일곱으로). 그래서 마비꼬 트랙은 아래처럼 찾는다.
 *
 * 1. 칸에 안 맞는 길이마다 "원래 이 값이었을 수 있는" 후보를 둔다: 그대로, 1틱(점·토막 수만큼 더) 안쪽의 깔끔한 길이,
 *    1틱 안쪽의 잇단 숫자(3·5·7·9·11·13 × 2의 거듭제곱. 21·27·29·38·42처럼 마비꼬·3MLE가 만든 숫자는 뺀다).
 *    붙은 쉼표(r5.r7.)와 &로 이은 같은 음(f&f18)은 한 덩어리로 본다.
 * 2. 한 묶음 안에서 같은 숫자로 적힌 음은 같은 값으로 고친다 (잇단음은 한 숫자로 쓰므로).
 * 3. 깔끔한 자리에서 시작해 음을 더해 가며, 후보 조합 가운데 16분·셋잇단 8분 칸에 "정확히" 닿는 것을 찾는다.
 *    가장 짧은 묶음에서, 덜 바꾸는 조합 하나만 받는다. 같은 정도로 맞는 조합이 둘 이상이면 짐작하지 않는다.
 *    그대로 둔 조합이 칸에 돌아오면 진짜 잇단음이라 건드리지 않는다.
 * 4. 앞 묶음을 고쳤다고 치고 뒤를 본다. 고칠 값이 없으면 그 뒤 자리를 새 기준으로 삼는다 (위 규칙과 같다).
 */

/** 마비꼬 트랙에서 원래 값 후보로 보는 잇단 숫자의 홀수 몫 */
const MABIICCO_TUPLET_ODD = [3, 5, 7, 9, 11, 13];
/** 한 묶음에서 따져 볼 조합 수 한도 (넘으면 그 묶음은 짐작하지 않는다) */
const MABIICCO_MAX_COMBOS = 4096;
/** 바꾸는 정도가 이만큼 안쪽으로 비기면 어느 쪽인지 짐작하지 않는다 */
const MABIICCO_TIE = 0.1;

/** 쉼표 사이에 있어도 쉼표를 잇는 글: 빈칸과 소리 없는 명령 */
const SILENT_GAP = /^(?:\s|[tvo]\d+|l\d+\.*|[<>])*$/i;

interface Chunk {
  /** 덩어리를 이룬 요소 번호 (하나 또는 붙은 쉼표·같은 음 붙임 여럿) */
  readonly ids: readonly number[];
  /** 사이에 명령이 끼었거나 깔끔한 토막이 섞인 덩어리 (통째로 다시 쓰면 명령·깔끔한 토막이 없어지므로 칸에 안 맞는 토막만 고친다) */
  readonly spread: boolean;
  readonly value: Rat;
  readonly clean: boolean;
}

interface Candidate {
  readonly value: Rat;
  /** 바꾸는 정도: 그대로 0, 깔끔한 한 토막 1, 잇단 숫자 1.5, 두 토막 2 (점마다 0.25, 적힌 값에서 1틱마다 1 더) */
  readonly cost: number;
  /** 다시 쓸 길이 토막 (그대로면 없음) */
  readonly pieces?: readonly string[];
  /** 사이에 명령이 낀 쉼표 덩어리를 토막마다 고친 것 (pieces 대신) */
  readonly edits?: readonly OffgridEdit[];
}

/** 길이 토막 글("16." 등) → 숫자와 점 수 */
const lengthOf = (piece: string): [number, number] => [Number(piece.replace(/\./g, "")), piece.length - piece.replace(/\./g, "").length];

const niceTuplet = (n: number) => {
  let k = n;
  while (k % 2 === 0) k /= 2;
  return MABIICCO_TUPLET_ODD.includes(k);
};

const absRat = (x: Rat) => (x.n < 0 ? rat(-x.n, x.d) : x);

/** 두 요소 사이 글이 덩어리로 이을 수 있는 것인지 (쉼표는 바로 붙어야, 음은 & 하나) */
function joins(text: string, a: Element, b: Element): boolean {
  const gap = text.slice(a.span[1], b.span[0]);
  // 쉼표 사이에 소리 없는 명령(t·v·o·l·<·>)만 있으면 이어진 쉼표다. 마비꼬는 템포가 바뀌는 자리에서 쉼표를 자르고 토막마다 따로 버린다
  if (a.kind === "rest" && b.kind === "rest") return SILENT_GAP.test(gap);
  if (a.kind !== "note" || b.kind !== "note" || a.pitch !== b.pitch) return false;
  // 같은 음 붙임: & 하나. 앞뒤에 소리 없는 명령(템포가 바뀌는 자리에서 자른 음의 t)이 있어도 된다
  const amp = gap.indexOf("&");
  return amp >= 0 && SILENT_GAP.test(gap.slice(0, amp)) && SILENT_GAP.test(gap.slice(amp + 1));
}

/** 요소를 덩어리로 묶는다. 칸에 안 맞는 요소가 든 붙은 쉼표·같은 음 붙임만 한 덩어리로 (나머지는 하나씩) */
function chunksOf(text: string, els: readonly Element[]): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  while (i < els.length) {
    let j = i;
    while (j + 1 < els.length && joins(text, els[j]!, els[j + 1]!)) j++;
    const run = els.slice(i, j + 1);
    if (j > i && run.some((el) => !isClean(el.dur))) {
      const value = run.reduce((s, el) => add(s, el.dur), rat(0));
      const plain = run[0]!.kind === "rest" ? "" : "&";
      // 사이에 명령이 끼었거나 깔끔한 토막이 섞였으면 토막마다 고친다 (명령과 쓴 사람이 적은 깔끔한 토막을 그대로 두려고)
      const spread = run.some((el, k) => isClean(el.dur) || (k > 0 && text.slice(run[k - 1]!.span[1], el.span[0]).trim() !== plain));
      out.push({ ids: run.map((_, k) => i + k), value, clean: isClean(value), spread });
      i = j + 1;
      continue;
    }
    for (let k = i; k <= j; k++) out.push({ ids: [k], value: els[k]!.dur, clean: isClean(els[k]!.dur), spread: false });
    i = j + 1;
  }
  return out;
}

/** 칸에 안 맞는 덩어리의 원래 값 후보 */
function candidatesOf(text: string, els: readonly Element[], chunk: Chunk, limit: LengthLimit, returns: boolean): Candidate[] {
  const first = els[chunk.ids[0]!]!;
  const written = chunk.ids.map((k) => text.slice(...els[k]!.span)).join("");
  // 묶음이 그대로 정확히 칸에 돌아오면(점 붙은 잇단음 l44. 열하나 등) 점 수만큼 늘린 허용 오차는 쓰지 않는다 (위 규칙과 같다)
  const dots = returns ? 0 : (written.match(/\./g) ?? []).length;
  // 허용 오차: 1틱에 토막·점 수만큼 더 (마비꼬·3MLE는 토막·점마다 한 번씩 버린다)
  const tolerance = rat(chunk.ids.length + dots, OFFGRID_CLEAN);
  const near = (v: Rat) => cmp(absRat(sub(v, chunk.value)), tolerance) < 0;
  // 적힌 값에서 멀수록 조금 더 바꾼 것으로 친다 (틱 수만큼)
  const away = (v: Rat) => Math.abs(toFloat(sub(v, chunk.value))) * OFFGRID_CLEAN;
  // n 음표는 길이를 붙일 수 없어 그대로만
  if (first.kind === "note" && !/^[a-g]/i.test(written)) return [{ value: chunk.value, cost: 0 }];
  const out: Candidate[] = [{ value: chunk.value, cost: 0 }];
  const ticks = (chunk.value.n * OFFGRID_CLEAN) / chunk.value.d;
  const reach = chunk.ids.length + dots;
  for (let k = Math.max(1, Math.ceil(ticks - reach)); k <= Math.floor(ticks + reach); k++) {
    const v = rat(k, OFFGRID_CLEAN);
    if (!near(v) || eq(v, chunk.value)) continue;
    // 여러 토막 덩어리(붙은 쉼표·같은 음 붙임)는 원래 토막 수(셋보다 적으면 셋)까지 (rrr4.r7 → r1.r1.r2r64)
    const pieces = cleanPieces(v, limit) ?? (chunk.ids.length > 1 ? greedyPieces(v, limit, Math.max(3, chunk.ids.length)) : undefined);
    if (!pieces) continue;
    // 음 하나로 적힌 길이가 원래 아주 짧은 두 토막(48&64 등)이었을 리는 없다: 두 토막이면 긴 토막이 16분음표 이상일 때만
    if (chunk.ids.length === 1 && pieces.length === 2 && cmp(noteLengthValue(...lengthOf(pieces[0]!)), rat(1, 16)) < 0) continue;
    const pieceDots = pieces.join("").split(".").length - 1;
    if (chunk.spread) {
      const edits = spreadEdits(text, els, chunk, v, limit);
      if (edits) out.push({ value: v, cost: 2 + away(v), edits });
      continue;
    }
    out.push({ value: v, cost: (pieces.length === 1 ? 1 : 2) + 0.25 * pieceDots + away(v), pieces });
  }
  // 그대로 정확히 돌아오는 묶음이면 다른 잇단 숫자로 바꾸지 않는다 (l44. 열하나를 l28 일곱으로 맞추는 일이 없게)
  if (chunk.ids.length === 1 && !returns) {
    for (let n = limit.min; n <= limit.max; n++) {
      const v = rat(1, n);
      if (isClean(v) || !niceTuplet(n) || eq(v, chunk.value) || !near(v)) continue;
      out.push({ value: v, cost: 1.5 + away(v), pieces: [String(n)] });
    }
  }
  return out;
}

/** 긴 토막부터 채워 max 토막 안에 딱 떨어지는 깔끔한 길이 토막 (점은 곡 한도와 1개 중 작은 것까지) */
function greedyPieces(x: Rat, limit: LengthLimit, max: number): string[] | undefined {
  const table: { text: string; value: Rat }[] = [];
  for (const n of CLEAN_LENGTHS) {
    if (n < limit.min || n > limit.max) continue;
    for (let dots = 0; dots <= Math.min(1, limit.dots); dots++) table.push({ text: `${n}${".".repeat(dots)}`, value: noteLengthValue(n, dots) });
  }
  table.sort((a, b) => cmp(b.value, a.value));
  const out: string[] = [];
  let left = x;
  while (left.n > 0 && out.length < max) {
    const piece = table.find((p) => cmp(p.value, left) <= 0);
    if (!piece) return undefined;
    out.push(piece.text);
    left = sub(left, piece.value);
  }
  return left.n === 0 ? out : undefined;
}

/**
 * 사이에 명령이 낀 덩어리(쉼표 또는 같은 음 붙임)를 합이 total이 되게 토막마다 고친다. 칸에 안 맞는 토막은 가장 가까운 깔끔한 길이로,
 * 마지막 칸에 안 맞는 토막이 나머지를 맡는다. 깔끔한 토막과 명령 자리는 그대로 둔다. 안 되면 undefined
 */
function spreadEdits(text: string, els: readonly Element[], chunk: Chunk, total: Rat, limit: LengthLimit): OffgridEdit[] | undefined {
  const odd = chunk.ids.filter((k) => !isClean(els[k]!.dur));
  if (odd.length === 0) return undefined;
  const edits: OffgridEdit[] = [];
  let left = total;
  for (const k of chunk.ids) if (!odd.includes(k)) left = sub(left, els[k]!.dur);
  for (const [n, k] of odd.entries()) {
    const el = els[k]!;
    let v: Rat | undefined;
    if (n === odd.length - 1) v = left;
    else {
      // 가장 가까운 깔끔한 길이 (1틱 안쪽부터 점 수만큼 더). 한 토막으로 쓸 수 있는 값을 먼저 (17틱 48&64.보다 18틱 32.)
      const ticks = (el.dur.n * OFFGRID_CLEAN) / el.dur.d;
      const reach = 1 + (text.slice(...el.span).match(/\./g) ?? []).length;
      const options: { t: number; pieces: number }[] = [];
      for (let t = Math.max(1, Math.ceil(ticks - reach)); t <= Math.floor(ticks + reach); t++) {
        const pieces = cleanPieces(rat(t, OFFGRID_CLEAN), limit);
        if (pieces) options.push({ t, pieces: pieces.length });
      }
      options.sort((a, b) => a.pieces - b.pieces || Math.abs(a.t - ticks) - Math.abs(b.t - ticks));
      if (options[0]) v = rat(options[0].t, OFFGRID_CLEAN);
    }
    if (!v || v.n <= 0) return undefined;
    const pieces = cleanPieces(v, limit) ?? greedyPieces(v, limit, 3);
    const to = pieces && rewrite(text, el, pieces);
    if (!to) return undefined;
    edits.push({ span: el.span, from: text.slice(...el.span), to });
    left = sub(left, v);
  }
  return edits;
}

/** 덩어리를 새 길이로 다시 쓴 고침 */
function chunkEdit(text: string, els: readonly Element[], chunk: Chunk, pieces: readonly string[]): OffgridEdit | undefined {
  const first = els[chunk.ids[0]!]!;
  const last = els[chunk.ids.at(-1)!]!;
  const to = rewrite(text, first, pieces);
  return to ? { span: [first.span[0], last.span[1]], from: text.slice(first.span[0], last.span[1]), to } : undefined;
}

const onLanding = (p: Rat) => OFFGRID_LANDINGS.some((g) => g % p.d === 0);

/** 마비꼬 트랙 원문 하나에서 고칠 자리를 찾는다 (위 설명의 규칙) */
export function findTrackOffgridMabiicco(text: string, limit: LengthLimit, offset?: Rat): Omit<OffgridFix, "trackId">[] {
  const parsed = parseMml(text);
  const els: Element[] = [
    ...parsed.notes.map((n) => ({ kind: "note" as const, start: n.start, dur: n.dur, pitch: n.pitch, span: n.span })),
    ...parsed.rests.map((r) => ({ kind: "rest" as const, start: r.start, dur: r.dur, span: r.span })),
  ].sort((a, b) => a.span[0] - b.span[0]);
  const chunks = chunksOf(text, els);
  const base = offset ?? rat(0);
  const out: Omit<OffgridFix, "trackId">[] = [];
  try {
    let pos = base;
    let shift = rat(0);
    let i = 0;
    /** 덩어리를 다음 덩어리로 넘기며 기준 자리를 옮긴다. rebase면 칸에서 비껴간 만큼을 새 기준으로 */
    const advance = (value: Rat, rebase: boolean) => {
      pos = add(pos, value);
      if (!rebase) return;
      const after = sub(pos, shift);
      shift = add(shift, sub(after, rat(Math.round((after.n * OFFGRID_CLEAN) / after.d), OFFGRID_CLEAN)));
    };
    while (i < chunks.length) {
      const here = sub(pos, shift);
      const chunk = chunks[i]!;
      if (!isClean(here) || chunk.clean) {
        advance(chunk.value, false);
        i++;
        continue;
      }
      let found = scanMabiicco(text, els, chunks, i, here, limit);
      if (found && "exact" in found) {
        // 진짜 잇단음: 그대로 돌아온 자리까지 넘긴다
        for (let k = i; k <= found.exact; k++) advance(chunks[k]!.value, false);
        i = found.exact + 1;
        continue;
      }
      if (found) {
        // 짧은 묶음으로 고친 뒤 바로 오는 칸에 안 맞는 덩어리를 고칠 수 없으면, 그 덩어리까지 넣은 긴 묶음으로 다시 본다
        // (r4.r7 c8&c9: 쉼표만 r3으로 맞추면 c8&c9가 맞지 않는다. 같이 보면 r7 → r8r64, c9 → c16&c32.)
        const next = found.last + 1;
        if (next < chunks.length && !chunks[next]!.clean) {
          const after = scanMabiicco(text, els, chunks, next, found.fix.landing, limit);
          if (!after) {
            const longer = scanMabiicco(text, els, chunks, i, here, limit, next);
            if (longer && !("exact" in longer)) found = longer;
          }
        }
        out.push({ ...found.fix, at: add(base, els[chunks[found.firstChunk]!.ids[0]!]!.start) });
        for (let k = i; k <= found.last; k++) {
          const v = found.values.get(k) ?? chunks[k]!.value;
          advance(v, false);
        }
        i = found.last + 1;
        continue;
      }
      advance(chunk.value, true);
      i++;
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return out;
  }
  return out;
}

type MabiiccoScan =
  | { exact: number }
  | { fix: Omit<OffgridFix, "trackId" | "at">; firstChunk: number; last: number; values: Map<number, Rat> }
  | undefined;

/**
 * i번 덩어리(깔끔한 자리 start에서 시작)부터 묶음을 본다. 그대로 칸에 돌아오면 exact, 고칠 조합이 하나로 정해지면 그 고침.
 * 처음 칸에 닿는 조합이 나온 뒤에도, 칸에 안 맞는 덩어리가 새로 끼지 않는 동안(뒤가 깔끔한 음뿐인 동안)은 더 가 보고
 * 그 가운데 가장 덜 바꾸는 조합을 고른다 (r19. 하나를 r12로 바로 맞추기보다 뒤 64분음표 셋까지 보고 r16r64로)
 */
function scanMabiicco(
  text: string,
  els: readonly Element[],
  chunks: readonly Chunk[],
  i: number,
  start: Rat,
  limit: LengthLimit,
  /** 이 덩어리까지 넣은 묶음만 받는다 (짧은 묶음으로 고치면 뒤가 맞지 않을 때 더 길게 보려고) */
  minLast = i,
): MabiiccoScan {
  /** 묶음 안 칸에 안 맞는 덩어리: 한 요소짜리는 적힌 값이 같으면 같은 차원(같은 값으로 고친다) */
  const dims: { key: string; candidates: Candidate[]; members: number[] }[] = [];
  const total = (pickOf: (d: number) => Rat) => dims.reduce((s, d, k) => add(s, rat(pickOf(k).n * d.members.length, pickOf(k).d)), rat(0));
  // 그대로 두어도 창 안에서 정확히 칸에 돌아오는 묶음인지
  let returns = false;
  for (let j = i, p = start; j < chunks.length; j++) {
    p = add(p, chunks[j]!.value);
    if (cmp(sub(p, start), add(OFFGRID_WINDOW, chunks[i]!.value)) > 0) break;
    if (isClean(p)) {
      returns = true;
      break;
    }
  }
  let fixed = rat(0);
  let best: { cost: number; pick: number[]; last: number; landing: Rat } | undefined;
  /** 최선 다음으로 덜 바꾸는 조합의 정도 (비김을 가리려고) */
  let second = Infinity;
  for (let j = i; j < chunks.length; j++) {
    const chunk = chunks[j]!;
    if (chunk.clean) fixed = add(fixed, chunk.value);
    else {
      // 조합을 찾은 뒤 칸에 안 맞는 덩어리가 또 오면 거기서 멈춘다 (그 덩어리는 다음 묶음에서 본다)
      if (best && j > minLast) break;
      const key = chunk.ids.length === 1 ? `${chunk.value.n}/${chunk.value.d}:${els[chunk.ids[0]!]!.kind}` : `chunk${j}`;
      const dim = dims.find((d) => d.key === key);
      if (dim) dim.members.push(j);
      else dims.push({ key, candidates: candidatesOf(text, els, chunk, limit, returns), members: [j] });
    }
    const keepEnd = add(start, add(fixed, total((k) => chunks[dims[k]!.members[0]!]!.value)));
    // 묶음은 첫 덩어리 뒤로 온음표 하나까지 (긴 쉼표 덩어리로 시작해도 뒤를 볼 수 있게)
    if (cmp(sub(keepEnd, start), add(OFFGRID_WINDOW, chunks[i]!.value)) > 0) break;
    // 그대로 칸에 돌아오면 진짜 잇단음
    if (isClean(keepEnd)) {
      if (!best && j >= minLast) return { exact: j };
      if (best) break;
    }
    const combos = dims.reduce((s, d) => s * d.candidates.length, 1);
    if (combos > MABIICCO_MAX_COMBOS) return undefined;
    const pick: number[] = new Array(dims.length).fill(0);
    for (let c = 0; c < combos; c++) {
      let rest = c;
      let cost = 0;
      for (let d = 0; d < dims.length; d++) {
        const dim = dims[d]!;
        pick[d] = rest % dim.candidates.length;
        rest = Math.floor(rest / dim.candidates.length);
        cost += dim.candidates[pick[d]!]!.cost;
      }
      if (cost === 0 || j < minLast) continue;
      const end = add(start, add(fixed, total((k) => dims[k]!.candidates[pick[k]!]!.value)));
      if (!onLanding(end)) continue;
      // 같은 조합이 뒤 칸에 또 닿는 것은 비김이 아니다 (처음 닿은 자리를 쓴다)
      const same = best !== undefined && best.pick.every((v, k) => v === pick[k]);
      if (same) continue;
      if (!best || cost < best.cost) {
        if (best) second = Math.min(second, best.cost);
        best = { cost, pick: [...pick], last: j, landing: end };
      } else second = Math.min(second, cost);
    }
  }
  if (!best) return undefined;
  // 같은 정도로 맞는 조합이 여럿이면 짐작하지 않는다
  if (second < best.cost + MABIICCO_TIE) return undefined;
  const edits: OffgridEdit[] = [];
  const values = new Map<number, Rat>();
  for (let d = 0; d < dims.length; d++) {
    const dim = dims[d]!;
    const cand = dim.candidates[best.pick[d]!]!;
    if (cand.edits) {
      edits.push(...cand.edits);
      for (const m of dim.members) values.set(m, cand.value);
      continue;
    }
    if (!cand.pieces) continue;
    for (const m of dim.members) {
      const edit = chunkEdit(text, els, chunks[m]!, cand.pieces);
      if (!edit) return undefined;
      edits.push(edit);
      values.set(m, cand.value);
    }
  }
  if (edits.length === 0) return undefined;
  edits.sort((a, b) => a.span[0] - b.span[0]);
  const firstChunk = Math.min(...values.keys());
  const head = els[chunks[firstChunk]!.ids[0]!]!;
  return {
    fix: { kind: edits.length > 1 ? "tuplet" : "single", pitch: head.pitch, start, landing: best.landing, edits },
    firstChunk,
    last: best.last,
    values,
  };
}
