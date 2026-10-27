import { add, cmp, toFloat, type Note } from "@mmlce/core";
import { chainVolumes } from "./scores";

/** 음표 볼륨 숫자: 끔 / 바뀌는 곳만 / 모든 음 */
export type VolumeLabelMode = "off" | "changes" | "all";

/** 저장해 둔 값을 읽는다. 없거나 모르는 값이면 끔 */
export function parseVolumeLabels(raw: string | null): VolumeLabelMode {
  return raw === "changes" || raw === "all" ? raw : "off";
}

/**
 * 볼륨 숫자를 쓸 음과 그 v (고르는 트랙 하나의 음). 피아노롤과 타브가 같이 쓴다.
 * v는 실제로 나는 값(&로 바로 이은 음은 사슬 첫 음 v)이고, 이음 사슬의 뒤 조각에는 쓰지 않는다.
 * all: 사슬 첫 음마다. changes: 트랙 첫 음, 앞 음(앞 사슬)과 v가 다른 음, 그리고 화면에서 처음 보이는 음(from 이후 첫 음).
 * 쉼표는 음이 아니라 비교에 끼지 않는다. from·to(온음표 단위, 화면 시간)가 있으면 그 안에서 시작하는 음만 돌려준다.
 * inView를 주면 그 밖의 음(롤에서 음 높이가 화면 밖)도 보이지 않는 것으로 보아, 화면에서 처음 보이는 음 자리를 차지하지 않는다
 */
export function volumeLabelNotes(
  notes: readonly Note[],
  mode: VolumeLabelMode,
  from = -Infinity,
  to = Infinity,
  inView: (n: Note) => boolean = () => true,
): Map<string, number> {
  const out = new Map<string, number>();
  if (mode === "off") return out;
  const vols = chainVolumes(notes);
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  let prevVol: number | undefined;
  let firstShown = false;
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    // 이음 사슬의 뒤 조각은 앞 음과 한 소리라 쓰지 않는다
    if (prev && prev.tie === "next" && cmp(add(prev.start, prev.dur), n.start) === 0) return;
    const vol = vols.get(n.id) ?? n.vol;
    const at = toFloat(n.start);
    const shown = at >= from && at < to && inView(n);
    const changed = prevVol === undefined || vol !== prevVol;
    prevVol = vol;
    if (!shown) return;
    if (mode === "all" || changed || !firstShown) out.set(n.id, vol);
    firstShown = true;
  });
  return out;
}

/** 앞 숫자 끝(시간 축 px, 없으면 undefined) 뒤에 이번 숫자(시작 px)를 쓸 수 있는지. 겹치면 이번 숫자는 건너뛴다 */
export function labelFits(prevEnd: number | undefined, startPx: number, gap = 1): boolean {
  return prevEnd === undefined || startPx >= prevEnd + gap;
}
