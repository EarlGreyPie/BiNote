import { gridLines, rat, type Rat, type TimeSigEvent } from "@mmlce/core";

/**
 * 타브 지판 칸: 누른 자리(곡 시간, 위에서 잰 y)가 어느 칸·어느 줄인지.
 * 시간은 그 자리가 속한 격자 칸의 왼쪽 끝(내림), 줄은 가장 가까운 줄(1 = 가장 높은 줄).
 * 누를 때와 마우스를 올렸을 때 보이는 칸 미리보기가 이 한 곳을 같이 써서 늘 같은 칸을 가리킨다
 */
export function tabCellAt(time: number, py: number, firstLine: number, gap: number, strings: number, division: number): { at: Rat; string: number } {
  const string = Math.min(strings, Math.max(1, Math.round((py - firstLine) / gap) + 1));
  const at = rat(Math.max(0, Math.floor(time * division + 1e-9)), division);
  return { at, string };
}

/** 마디 번호 줄 눈금 하나: 박(조금 길게)이나 입력 격자 칸(짧게). 마디선 자리는 빼고 (마디선이 이미 있다) */
export interface RulerTick {
  readonly at: number;
  readonly kind: "beat" | "cell";
}

/**
 * 마디 번호 줄 아래쪽에 그릴 박·격자 칸 눈금. 박은 박자표대로(복합 박자는 점4분 박), 칸은 입력 격자(온음표의 1/division)마다.
 * 칸 폭이 minCellPx보다 좁으면 칸 눈금은 빼고 박만 (너무 촘촘하면 읽을 수 없다). 박 자리와 겹치는 칸 눈금은 하나만
 */
export function rulerTicks(timeSig: readonly TimeSigEvent[], division: number, from: number, to: number, pxPerWhole: number, minCellPx = 6): RulerTick[] {
  const lines = gridLines(timeSig, from, to);
  const taken = (at: number) => lines.some((l) => l.kind !== "unit" && Math.abs(l.at - at) < 1e-9);
  const out: RulerTick[] = lines.filter((l) => l.kind === "beat").map((l) => ({ at: l.at, kind: "beat" as const }));
  if (division > 0 && pxPerWhole / division >= minCellPx) {
    for (let k = Math.max(0, Math.ceil(from * division - 1e-9)); k / division < to; k++) {
      const at = k / division;
      if (!taken(at)) out.push({ at, kind: "cell" });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
