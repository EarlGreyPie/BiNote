import { add, cmp, eq } from "@mmlce/core";
import type { PrintableNote } from "./printer.js";

/** prev가 &로 n과 맞닿아 이어지는지 (n은 & 뒤 음) */
export function continues(prev: PrintableNote, n: PrintableNote): boolean {
  return prev.tie === "next" && eq(add(prev.start, prev.dur), n.start);
}

/**
 * & 뒤의 v는 게임에서 무시된다(실측). 이어진 음의 볼륨을 사슬 첫 음 볼륨으로 맞춘 목록을 돌려준다.
 * 출력기는 & 뒤에 v를 쓰지 않으므로, 출력 전후를 비교할 때 이것으로 맞춘다.
 */
export function heardVolumes<T extends PrintableNote>(notes: readonly T[]): T[] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const out: T[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    out.push(prev && continues(prev, n) && prev.vol !== n.vol ? { ...n, vol: prev.vol } : n);
  }
  return out;
}

/**
 * 같은 높이로 &로 이어진 음을 하나로 합친다. 소리로는 같은 음이다.
 * 출력기는 음 중간의 템포 때문에 c2를 c4&c4로 나눌 수 있으므로, 출력 전후를 비교할 때 쓴다.
 * & 뒤 음의 볼륨은 게임처럼 앞 음 볼륨으로 본다.
 */
export function mergeTies<T extends PrintableNote>(notes: readonly T[]): PrintableNote[] {
  const out: PrintableNote[] = [];
  for (const n of heardVolumes(notes)) {
    const prev = out[out.length - 1];
    if (prev && continues(prev, n) && prev.pitch === n.pitch && prev.vol === n.vol) {
      out[out.length - 1] = { start: prev.start, dur: add(prev.dur, n.dur), pitch: n.pitch, vol: n.vol, tie: n.tie };
    } else {
      out.push({ start: n.start, dur: n.dur, pitch: n.pitch, vol: n.vol, tie: n.tie });
    }
  }
  return out;
}

/** 두 음 목록이 소리로 같은지 */
export function sameSound(a: readonly PrintableNote[], b: readonly PrintableNote[]): boolean {
  const x = mergeTies(a);
  const y = mergeTies(b);
  return (
    x.length === y.length &&
    x.every((n, k) => {
      const m = y[k]!;
      return eq(n.start, m.start) && eq(n.dur, m.dur) && n.pitch === m.pitch && n.vol === m.vol && n.tie === m.tie;
    })
  );
}
