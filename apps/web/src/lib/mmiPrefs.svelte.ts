import { loadStored, saveStored } from "./persist";

/**
 * 마비꼬(.mmi) 저장·가져오기 창을 건너뛸지 (이 브라우저에 기억). 창 안의 체크와 설정 → 저장에서 바꾼다.
 * exportQuick: 창 없이 권장 설정(자동 묶기, 모든 트랙)으로 저장 (기본 끔)
 * importQuick: 창 없이 권장 설정(화음 수까지 악보 하나로 모으기)으로 가져오기 (기본 끔)
 */
const EXPORT = "mmlce.mmiExportQuick";
const IMPORT = "mmlce.mmiImportQuick";

export const mmiPrefs = $state({
  exportQuick: loadStored(EXPORT, (raw) => raw === "1"),
  importQuick: loadStored(IMPORT, (raw) => raw === "1"),
});

export function setMmiExportQuick(on: boolean): void {
  mmiPrefs.exportQuick = on;
  saveStored(EXPORT, on ? "1" : "0");
}

export function setMmiImportQuick(on: boolean): void {
  mmiPrefs.importQuick = on;
  saveStored(IMPORT, on ? "1" : "0");
}
