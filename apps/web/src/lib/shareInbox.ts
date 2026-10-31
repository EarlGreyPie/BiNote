/**
 * 폰 공유 시트로 받은 것(share_target) 꺼내기.
 * 공유하면 브라우저가 글·파일을 ./share-target으로 보낸다(POST). 서비스 워커(public/sw.js)가 그것을 받아
 * 이 캐시에 넣고 앱을 ./?share-target으로 연다. 앱은 여기서 꺼내 열고 캐시를 지운다.
 * 이름·약속은 public/sw.js와 똑같아야 한다 (test/shareInbox.test.ts가 둘을 맞춰 본다)
 */

/** 받은 것을 잠시 담는 캐시. 판을 바꿀 때 지우는 앱 캐시(mmlce-…)와 따로 둔다 */
export const SHARE_CACHE = "mmlce-share";
/** 서비스 워커가 받은 것을 넣은 뒤 앱을 여는 주소에 붙는 표시 */
export const SHARE_QUERY = "share-target";
/** 캐시에 넣은 한 건이 글인지 파일인지, 파일 이름 (encodeURIComponent) */
export const SHARE_KIND_HEADER = "X-Share-Kind";
export const SHARE_NAME_HEADER = "X-Share-Name";

export interface SharedItems {
  readonly files: readonly File[];
  /** 함께 받은 글 (본문, 제목, 주소 순). 빈 글은 뺀다 */
  readonly texts: readonly string[];
}

/** 이 주소가 공유를 받아 열린 것인지 */
export function isShareLaunch(search: string): boolean {
  return new URLSearchParams(search).has(SHARE_QUERY);
}

/** 공유 표시를 뗀 주소 (새로고침해도 같은 것을 다시 열지 않게) */
export function withoutShareQuery(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(SHARE_QUERY);
  return url.href;
}

/** 받아 둔 것을 꺼내고 캐시를 지운다. 캐시를 못 쓰거나 없으면 빈 것 */
export async function takeShared(store: CacheStorage | undefined = globalThis.caches): Promise<SharedItems> {
  if (!store) return { files: [], texts: [] };
  const files: File[] = [];
  const texts: string[] = [];
  try {
    if (!(await store.has(SHARE_CACHE))) return { files, texts };
    const cache = await store.open(SHARE_CACHE);
    for (const key of await cache.keys()) {
      const response = await cache.match(key);
      if (!response) continue;
      if (response.headers.get(SHARE_KIND_HEADER) === "text") {
        const text = (await response.text()).trim();
        if (text) texts.push(text);
        continue;
      }
      const name = decodeURIComponent(response.headers.get(SHARE_NAME_HEADER) ?? "") || "shared";
      const blob = await response.blob();
      files.push(new File([blob], name, { type: blob.type }));
    }
  } catch {
    // 읽다 실패하면 읽은 데까지만 연다
  }
  try {
    await store.delete(SHARE_CACHE);
  } catch {
    // 다음 공유가 덮어쓴다
  }
  return { files, texts };
}
