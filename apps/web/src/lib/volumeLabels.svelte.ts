import { loadStored, saveStored } from "./persist";
import { parseVolumeLabels, type VolumeLabelMode } from "./volumeLabels";

/**
 * 음표 볼륨 숫자 (보기 설정, 이 브라우저에 기억). 기본은 끔, 설정 → 화면에서 고른다.
 * 켜면 피아노롤 음 옆과 타브 맨 아래 볼륨 줄에 고르는 트랙 음의 v 숫자를 쓴다
 */
const KEY = "mmlce.volumeLabels";

export const volumeLabels = $state<{ mode: VolumeLabelMode }>({ mode: loadStored(KEY, parseVolumeLabels) });

export function setVolumeLabels(mode: VolumeLabelMode): void {
  volumeLabels.mode = mode;
  saveStored(KEY, mode);
}
