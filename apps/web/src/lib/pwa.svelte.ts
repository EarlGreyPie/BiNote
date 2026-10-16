/**
 * 서비스 워커 등록과 새 판 안내, 저장 공간 지속 요청.
 * 새 판은 바로 바꾸지 않고 기다리게 한다. 열려 있는 탭이 옛 판 파일을 계속 쓸 수 있어야
 * 나중에 불러오는 파일(WAV 저장·소리 엔진)이 깨지지 않는다. 사용자가 새로고침을 고르면 그때 바꾼다.
 */
export const pwa = $state<{
  updateReady: boolean;
  /** 새로고침 전에 작업을 보존하지 못해 바꾸지 않았다 */
  updateFailed: boolean;
  storage: "unknown" | "persisted" | "best-effort" | "unsupported";
}>({
  updateReady: false,
  updateFailed: false,
  storage: "unknown",
});

let waiting: ServiceWorker | null = null;
/** 이 탭에서 새로고침을 골랐는지. 다른 탭은 새 워커로 넘어가도 저절로 새로고침하지 않는다 */
let requested = false;

function watch(reg: ServiceWorkerRegistration): void {
  const offer = (sw: ServiceWorker | null) => {
    // 처음 설치(아직 이 탭을 맡은 워커가 없음)는 안내할 새 판이 아니다
    if (!sw || !navigator.serviceWorker.controller) return;
    waiting = sw;
    pwa.updateReady = true;
  };
  offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    sw?.addEventListener("statechange", () => {
      if (sw.state === "installed") offer(sw);
    });
  });
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("./sw.js")
    .then(watch)
    .catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!requested) return;
    requested = false;
    location.reload();
  });
}

/**
 * 새 판으로 바꾸고 새로고침한다. 그 전에 할 일(자동 보존 등)이 끝나기를 기다리고,
 * 실패하면 바꾸지 않는다 (사용자가 프로젝트로 저장한 뒤 다시 누를 수 있게).
 * 다른 탭에서 이미 바꿨으면 이 탭은 새로고침만 하면 된다
 */
export async function applyUpdate(before?: () => Promise<void> | void): Promise<void> {
  try {
    await before?.();
  } catch {
    pwa.updateFailed = true;
    return;
  }
  pwa.updateFailed = false;
  if (waiting && waiting.state === "installed") {
    requested = true;
    waiting.postMessage("skip-waiting");
  } else {
    location.reload();
  }
}

/** 지금 저장 공간이 지속 상태인지 읽어 둔다 (설정 창에 보여 준다) */
export async function checkStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persisted) {
      pwa.storage = "unsupported";
      return;
    }
    pwa.storage = (await navigator.storage.persisted()) ? "persisted" : "best-effort";
  } catch {
    pwa.storage = "unsupported";
  }
}

/**
 * 브라우저가 공간이 모자랄 때 자동 보존·저장한 사운드팩을 지우지 않게 해 달라고 요청한다.
 * 허락돼도 사용자가 브라우저 데이터를 지우면 사라지므로, 프로젝트 파일 저장 안내는 그대로 둔다.
 * 거절·오류여도 앱 동작은 그대로이고, 결과는 pwa.storage에 남긴다
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist) {
      pwa.storage = "unsupported";
      return;
    }
    if (await navigator.storage.persisted()) {
      pwa.storage = "persisted";
      return;
    }
    pwa.storage = (await navigator.storage.persist()) ? "persisted" : "best-effort";
  } catch {
    pwa.storage = "unsupported";
  }
}
