import type { Note, TrackRole } from "./model.js";
import { applyVolumes, tieChains } from "./note-edit.js";
import type { GameProfile } from "./profile.js";
import { add, cmp, ZERO, type Rat } from "./rat.js";
import { volumeForDb } from "./volume.js";

/**
 * 편집기 안 화음 감쇠: 한 악보(연주자)의 트랙에서 함께 울리는 음 수를 세어, 음마다 지금 v에서 낮춘다.
 *
 * 세는 법
 * - 같은 자리에서 시작한 음만 세면 굴린(롤) 화음·끌린 화음을 놓친다 (Someday 74–84마디: 같이 시작 1.28음, 함께 울림 2.3음).
 *   그래서 음마다 "그 음 시작부터 roll 길이 안에서 가장 많이 함께 울린 같은 무리 음 수"를 센다.
 *   먼저 울리고 있던 음, 같이 시작한 음, roll 안에 굴려 들어온 음이 모두 들어간다. 빠른 단선율은 한 순간에 한 음이라 1음이다.
 * - 울림은 & 사슬 전체 길이로 본다 (게임은 & 뒤 v를 읽지 않으므로 v는 사슬 첫 음 것 하나다).
 * - v0(소리 없음) 사슬은 세지도 바꾸지도 않는다.
 *
 * 무리 나누기 (따로 세기)
 * - pitch: 그 순간 울리는 음높이의 가장 넓은 틈(8반음 이상)으로 위·아래를 나눈다 (틈이 없으면 한 무리)
 * - role: 트랙 역할로 나눈다 (멜로디 / 베이스 / 나머지)
 * - none: 악보 전체를 한 무리로
 */
export type AttenuationSplit = "pitch" | "role" | "none";

/**
 * 낮추는 양
 * - steps: 함께 울린 음 수에 따라 정한 단계만큼 (MMLCS처럼 2음 −1, 3음 −2, 4음 이상 −3)
 * - law: 볼륨 곡선으로 화음 전체가 단음 크기가 되게 (n음이면 perDoublingDb × log2(n) dB 낮춘 v)
 */
export type AttenuationAmount =
  | { readonly kind: "steps"; readonly two: number; readonly three: number; readonly fourPlus: number }
  | { readonly kind: "law" };

export interface AttenuationOptions {
  readonly split: AttenuationSplit;
  readonly amount: AttenuationAmount;
  /** 시작 뒤 이 길이 안에 굴려 들어오는 음도 같은 화음으로 센다. 0이면 시작 순간만 (먼저 울리던 음은 센다) */
  readonly roll: Rat;
  /** 같은 자리에서 시작한 음만 센다 (먼저 울리던 음·굴린 음은 세지 않는다. 예전 MIDI 가져오기 방식) */
  readonly sameStartOnly: boolean;
  /** 이보다 낮추지 않는다. 기준 v가 처음부터 이보다 작은 음은 낮추지 않는다 (올리지도 않는다) */
  readonly floor: number;
  /** 단음 기준 v. 주면 고른 음을 먼저 이 v로 두고 낮춘다. 없으면 지금 v가 기준 */
  readonly base?: number;
}

export interface AttenuationTrack {
  readonly id: string;
  readonly role: TrackRole;
  readonly notes: readonly Note[];
}

export interface AttenuationResult {
  /** 트랙 id → 바뀐 음 (순서·자리 그대로, vol만 바뀐다). 바뀐 음이 없는 트랙은 빠진다 */
  readonly tracks: ReadonlyMap<string, Note[]>;
  /** 고른 소리 수 (& 사슬 하나를 한 음으로) */
  readonly count: number;
  /** v가 바뀌는 소리 수 */
  readonly changed: number;
  /** 함께 울린 음 수 → 소리 수 (고른 소리만, 1음 포함) */
  readonly bySize: ReadonlyMap<number, number>;
  /** 같은 자리에서 시작한 음만 셌다면 더 적게 셌을 소리 수 (먼저 울리던 음·굴린 음 덕에 더 낮아진 곳) */
  readonly fromOverlap: number;
  /** floor에서 멈춘 소리 수 */
  readonly floored: number;
  /** & 뒤 이어진 음만 골라 사슬 첫 음부터 함께 바꾼 소리 수 */
  readonly viaTie: number;
  /** 지금 / 바꾼 뒤 v [최소, 최대] (고른 소리만) */
  readonly before: readonly [number, number] | undefined;
  readonly after: readonly [number, number] | undefined;
}

interface Sound {
  readonly trackId: string;
  readonly role: TrackRole;
  readonly head: Note;
  /** & 사슬 전체 (높이가 바뀌는 사슬은 그 순간 울리는 음 높이로 무리를 나눈다) */
  readonly chain: readonly Note[];
  readonly start: Rat;
  readonly end: Rat;
  readonly picked: boolean;
  readonly viaTie: boolean;
}

/** 위·아래 무리를 가르는 가장 작은 음높이 틈 (반음). 기타 화음의 4도·5도 쌓기는 가르지 않고, 따로 노는 베이스·멜로디만 가른다 */
const SPLIT_GAP = 8;

/**
 * 음높이에서 가장 넓은 틈(SPLIT_GAP 이상)의 가운데. 틈이 없으면 나누지 않는다 (-Infinity: 모두 위 무리).
 * MIDI 가져오기의 손 나누기(5반음, 없으면 가운데 도)보다 덜 가른다: 편집기 트랙은 이미 사람이 나눈 성부라 붙은 화음을 둘로 가르지 않게
 */
function pitchSplit(pitches: readonly number[]): number {
  const sorted = [...pitches].sort((a, b) => a - b);
  let best = -Infinity;
  let widest = SPLIT_GAP - 1;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gap = sorted[i + 1]! - sorted[i]!;
    if (gap > widest) {
      widest = gap;
      best = (sorted[i]! + sorted[i + 1]!) / 2;
    }
  }
  return best;
}

/** t에 울리는 사슬 음의 높이 (사슬 밖이면 첫 음 높이) */
function pitchAt(s: Sound, t: Rat): number {
  for (let i = s.chain.length - 1; i >= 0; i--) if (cmp(s.chain[i]!.start, t) <= 0) return s.chain[i]!.pitch;
  return s.head.pitch;
}

const roleGroup = (role: TrackRole) => (role === "melody" ? "melody" : role === "bass" ? "bass" : "rest");

/** n음 화음 안의 음 v. 지금 v(vol)에서 낮춘다 (올리지 않는다) */
export function attenuatedVolume(vol: number, size: number, amount: AttenuationAmount, profile: Pick<GameProfile, "volume" | "volumeCurve" | "chordAttenuation">): number {
  if (size < 2 || vol <= 0) return vol;
  if (amount.kind === "steps") {
    const by = size === 2 ? amount.two : size === 3 ? amount.three : amount.fourPlus;
    return Math.min(vol, vol - Math.max(0, Math.round(by)));
  }
  const { min, max } = profile.volume;
  const at = profile.volumeCurve[Math.min(max, Math.max(min, vol)) - min] ?? -Infinity;
  const target = at - profile.chordAttenuation.perDoublingDb * Math.log2(size);
  return Math.min(vol, volumeForDb(profile, target));
}

/**
 * 한 악보 트랙들(tracks)에서 picked 트랙의 음 v를 화음 감쇠한다. picked: 트랙 id → 고른 음 id (undefined면 그 트랙 전체).
 * 세는 데는 tracks의 모든 음을 쓴다 (고르지 않은 음도 함께 울리면 센다)
 */
export function attenuateChordVolumes(
  tracks: readonly AttenuationTrack[],
  picked: ReadonlyMap<string, ReadonlySet<string> | undefined>,
  options: AttenuationOptions,
  profile: Pick<GameProfile, "volume" | "volumeCurve" | "chordAttenuation">,
): AttenuationResult {
  const { min, max } = profile.volume;
  const sounds: Sound[] = [];
  for (const track of tracks) {
    const wanted = picked.has(track.id);
    const ids = picked.get(track.id);
    for (const chain of tieChains(track.notes)) {
      const head = chain[0]!;
      const last = chain[chain.length - 1]!;
      const isPicked = wanted && (!ids || chain.some((n) => ids.has(n.id)));
      if (head.vol <= 0) continue;
      sounds.push({
        trackId: track.id,
        role: track.role,
        head,
        chain,
        start: head.start,
        end: add(last.start, last.dur),
        picked: isPicked,
        viaTie: isPicked && !!ids && !ids.has(head.id),
      });
    }
  }
  sounds.sort((a, b) => cmp(a.start, b.start));

  // 함께 울리는 음을 세는 순간 t: 이 소리와 같은 무리에서 t에 울리는 소리 수
  const sizeAt = (s: Sound, t: Rat, pool: readonly Sound[]): number => {
    const sounding = pool.filter((x) => cmp(x.start, t) <= 0 && cmp(x.end, t) > 0);
    if (options.split === "none") return sounding.length;
    if (options.split === "role") return sounding.filter((x) => roleGroup(x.role) === roleGroup(s.role)).length;
    const split = pitchSplit(sounding.map((x) => pitchAt(x, t)));
    const up = pitchAt(s, t) >= split;
    return sounding.filter((x) => pitchAt(x, t) >= split === up).length;
  };
  const sameStartSize = (s: Sound, pool: readonly Sound[]): number => {
    const together = pool.filter((x) => cmp(x.start, s.start) === 0);
    if (options.split === "none") return together.length;
    if (options.split === "role") return together.filter((x) => roleGroup(x.role) === roleGroup(s.role)).length;
    const split = pitchSplit(together.map((x) => x.head.pitch));
    const up = s.head.pitch >= split;
    return together.filter((x) => x.head.pitch >= split === up).length;
  };

  const newVol = new Map<Sound, number>();
  const bySize = new Map<number, number>();
  let count = 0;
  let changed = 0;
  let fromOverlap = 0;
  let floored = 0;
  let viaTie = 0;
  let before: [number, number] | undefined;
  let after: [number, number] | undefined;
  const widen = (a: [number, number] | undefined, v: number): [number, number] => (!a ? [v, v] : [Math.min(a[0], v), Math.max(a[1], v)]);
  // 시작 순으로 훑으며 아직 울리는 소리만 들고 간다
  let active: Sound[] = [];
  let next = 0;
  for (const s of sounds) {
    if (!s.picked) continue;
    const roll = cmp(options.roll, ZERO) > 0 ? options.roll : ZERO;
    const windowEnd = add(s.start, roll);
    const until = cmp(windowEnd, s.end) < 0 ? windowEnd : s.end;
    // 굴림 폭 끝에 꼭 맞춰 들어온 음도 같은 화음 (이 음이 그때 아직 울릴 때만)
    const closed = cmp(windowEnd, s.end) < 0;
    const inWindow = (x: Sound) => cmp(x.start, until) < 0 || (closed && cmp(x.start, until) === 0);
    while (next < sounds.length && cmp(sounds[next]!.start, until) <= 0) active.push(sounds[next++]!);
    active = active.filter((x) => cmp(x.end, s.start) > 0);
    const pool = active.filter((x) => inWindow(x) || cmp(x.start, s.start) === 0);
    let size: number;
    const same = sameStartSize(s, pool);
    if (options.sameStartOnly) size = same;
    else {
      // 시작 순간과, 창 안에서 다른 음이 들어오는 순간마다 센다
      size = sizeAt(s, s.start, pool);
      for (const x of pool) if (cmp(x.start, s.start) > 0 && inWindow(x)) size = Math.max(size, sizeAt(s, x.start, pool));
      if (size > same) fromOverlap++;
    }
    const from = options.base !== undefined ? Math.min(max, Math.max(min, options.base)) : s.head.vol;
    let vol = attenuatedVolume(from, size, options.amount, profile);
    if (from < options.floor) vol = from;
    else if (vol < options.floor) {
      vol = options.floor;
      floored++;
    }
    vol = Math.min(max, Math.max(min, vol));
    count++;
    if (s.viaTie) viaTie++;
    bySize.set(size, (bySize.get(size) ?? 0) + 1);
    before = widen(before, s.head.vol);
    after = widen(after, vol);
    if (vol !== s.head.vol) changed++;
    newVol.set(s, vol);
  }

  const out = new Map<string, Note[]>();
  for (const track of tracks) {
    const byHead = new Map<string, number>();
    for (const [s, v] of newVol) if (s.trackId === track.id && v !== s.head.vol) byHead.set(s.head.id, v);
    if (byHead.size === 0) continue;
    out.set(track.id, applyVolumes(track.notes, byHead));
  }
  return { tracks: out, count, changed, bySize, fromOverlap, floored, viaTie, before, after };
}
