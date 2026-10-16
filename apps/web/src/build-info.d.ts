/** vite 설정이 빌드할 때 넣는 판 정보 (개발 서버에서는 그 시각 기준) */
/** published: 공개 저장소(Cloudflare Pages)에서 빌드했으면 true. 그때만 커밋이 공개 저장소의 커밋이다 */
declare const __MMLCE_BUILD__: { readonly version: string; readonly commit: string; readonly date: string; readonly published: boolean };
