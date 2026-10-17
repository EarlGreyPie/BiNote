/** vite 설정이 빌드할 때 넣는 판 정보. build는 "YYMMDD vN" (커밋한 날 KST, 그날 몇 번째 커밋인지. 못 세면 날짜만) */
/** published: 공개 저장소(Cloudflare Pages)에서 빌드했으면 true. 그때만 커밋이 공개 저장소의 커밋이다 */
/** 이 판의 CHANGELOG 절 (Markdown). 없으면 "" */
declare const __MMLCE_NOTES__: string;
declare const __MMLCE_BUILD__: { readonly version: string; readonly commit: string; readonly build: string; readonly published: boolean };
