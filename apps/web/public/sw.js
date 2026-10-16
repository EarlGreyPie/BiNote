// 오프라인 실행용 서비스 워커. 앱 파일을 처음 받을 때 담아 두고,
// 연결이 없으면 담아 둔 것을 쓴다. 사운드팩·악보 파일은 사용자가 직접 고르므로 담지 않는다.
// 빌드할 때 vite 설정(precacheList)이 이 두 줄을 채운다: 빌드마다 바뀌는 캐시 이름과 앱 파일 목록.
// 소리 엔진·글꼴처럼 나중에 불러오는 파일도 처음 설치할 때 받아 두어, 처음부터 오프라인에서 쓸 수 있게 한다
const CACHE = "mmlce-dev";
const PRECACHE = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 하나라도 못 받으면 설치를 실패시켜 예전 판(과 그 캐시)을 그대로 쓴다. 다음 방문에 다시 시도한다
      .then((cache) => cache.addAll(PRECACHE)),
  );
  // 바로 바꾸지 않는다. 열려 있는 탭은 옛 판 파일을 계속 써야 한다. 앱이 새 판 안내를 띄우고,
  // 사용자가 새로고침을 고르면 skip-waiting을 보낸다. 탭을 모두 닫으면 다음에 열 때 저절로 바뀐다
});
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        // 다른 탭이 아직 옛 판으로 열려 있으면 옛 캐시를 남겨 둔다. 그 탭이 나중에 불러오는 파일(WAV 저장 등)은
        // 서버에서 없어졌어도 여기서 찾는다(아래 fetch). 남은 옛 캐시는 다음 판으로 바뀔 때 정리한다
        const windows = await self.clients.matchAll({ type: "window" });
        if (windows.length > 1) return;
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  // 새 버전을 먼저 받아 보고, 안 되면 담아 둔 것
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        }
        // 새로 배포해 옛 판 파일이 서버에서 없어졌으면(404) 담아 둔 것을 쓴다
        return caches.match(request).then((cached) => cached ?? response);
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});
