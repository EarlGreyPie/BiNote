import { diagnosticText, displayInfo, enabledLabs, errorLog } from "./diagnostics";
import { i18n } from "./i18n.svelte";
import { labs } from "./labs.svelte";
import { loadStored } from "./persist";

/** 오선보 칸(실험실)을 켰는지. App의 보기 설정과 같은 저장 키 */
const STAFF_KEY = "mmlce.staffView";

/** 지금 앱의 진단 정보 글 (정보 창·깨진 보기의 [진단 정보 복사]) */
export function diagnosticReport(): string {
  const staff = loadStored(STAFF_KEY, (raw) => raw === "1");
  return diagnosticText({
    version: __MMLCE_BUILD__.version,
    build: __MMLCE_BUILD__.build,
    commit: __MMLCE_BUILD__.commit,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    locale: i18n.locale,
    display: displayInfo(),
    labs: enabledLabs(labs, staff ? ["staff"] : []),
    errors: errorLog.list(),
  });
}
