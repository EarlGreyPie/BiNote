import type { Extras } from "@mmlce/core";
import {
  decodeText,
  looksLikeMmlAt,
  isProjectFileName,
  looksLikeProject,
  read3mle,
  readMmi,
  readMmlAt,
  readProject,
  type ProjectEditor,
  type ReadResult,
} from "@mmlce/fileio";
import { t } from "./i18n.svelte";

/** 프로젝트 파일이면 편집 화면 상태와 모르는 맨 위 필드도 함께 */
export type OpenResult = ReadResult & { readonly editor?: ProjectEditor; readonly extras?: Extras };

/**
 * 확장자로 형식을 고른다. 프로젝트 확장자(PROJECT_EXTENSIONS)는 MMLCE 프로젝트, .mmi는 마비꼬, 게임 MML@ 글이면 그것으로,
 * 나머지(.mml·.txt)는 3MLE 형식으로 읽는다. 프로젝트를 열 수 없으면 ProjectError를 던진다
 */
export async function openScore(file: File): Promise<OpenResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // 프로젝트는 늘 UTF-8 (3MLE처럼 CP949로 다시 읽지 않는다)
  if (isProjectFileName(file.name)) return readProject(new TextDecoder().decode(bytes));
  const text = decodeText(bytes);
  if (looksLikeProject(text)) return readProject(text);
  if (/\.mmi$/i.test(file.name)) {
    const parts = [t("ui.mmiMelody"), t("ui.mmiChord", { n: 1 }), t("ui.mmiChord", { n: 2 }), t("ui.mmiSong")] as const;
    return readMmi(text, { parts, songPlayer: (name) => t("ui.mmiSongPlayer", { name }) });
  }
  if (looksLikeMmlAt(text)) return readMmlAt(text, { playerName: t("ui.pastePlayer") });
  return read3mle(text, { scoreName: (n) => t("ui.scoreN", { n }) });
}
