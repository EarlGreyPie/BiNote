/**
 * 서비스 워커 등록과 새 판 안내, 저장 공간 지속 요청.
 * 새 판은 바로 바꾸지 않고 기다리게 한다. 열려 있는 탭이 옛 판 파일을 계속 쓸 수 있어야
 * 나중에 불러오는 파일(WAV 저장·소리 엔진)이 깨지지 않는다. 사용자가 새로고침을 고르면 그때 바꾼다.
 */
export const pwa = $state<{
  /** 위쪽 새 판 안내 띠를 보일지. 닫기(×)를 누르면 꺼지지만 받아 둔 새 판(newVersion)은 남는다 */
  updateReady: boolean;
  /** 받아 두고 기다리는 새 판의 번호. 없으면 null, 번호를 못 읽었으면 "" */
  newVersion: string | null;
  /** 정보 창의 업데이트 확인 상태. unsupported는 서비스 워커가 없는 환경(개발 서버·사생활 보호 창 등) */
  check: "idle" | "checking" | "latest" | "failed" | "unsupported";
  /** 마지막으로 새 판을 확인한 시각(ms). 확인하지 않았으면 0 */
  lastChecked: number;
  /** 새로고침 전에 작업을 보존하지 못해 바꾸지 않았다 */
  updateFailed: boolean;
  storage: "unknown" | "persisted" | "best-effort" | "unsupported";
}>({
  updateReady: false,
  newVersion: null,
  check: "idle",
  lastChecked: 0,
  updateFailed: false,
  storage: "unknown",
});

let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
/** 창으로 돌아올 때 조용히 확인하는 최소 간격 */
const AUTO_CHECK_MS = 60 * 60 * 1000;
/** 이 탭에서 새로고침을 골랐는지. 다른 탭은 새 워커로 넘어가도 저절로 새로고침하지 않는다 */
let requested = false;

/** 다 받아 두고 기다리는 새 워커를 안내한다 */
function offer(sw: ServiceWorker | null): void {
  // 처음 설치(아직 이 탭을 맡은 워커가 없음)는 안내할 새 판이 아니다
  if (!sw || !navigator.serviceWorker.controller || sw === waiting) return;
  waiting = sw;
  pwa.updateReady = true;
  pwa.newVersion = "";
  void askVersion(sw).then((v) => {
    if (waiting === sw) pwa.newVersion = v;
  });
}

function watch(reg: ServiceWorkerRegistration): void {
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
    .then((reg) => {
      registration = reg;
      // 등록할 때 브라우저가 이미 새 판을 한 번 확인한다
      pwa.lastChecked = Date.now();
      watch(reg);
    })
    .catch(() => {});
  // 앱을 오래 켜 둔 채 쓰면 브라우저가 새 판을 다시 확인하지 않을 수 있다. 창으로 돌아올 때 한 시간에 한 번 조용히 확인한다
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - pwa.lastChecked >= AUTO_CHECK_MS) void checkForUpdate(true);
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!requested) return;
    requested = false;
    location.reload();
  });
}

/** 서비스 워커에게 자기 판 번호를 묻는다. 답이 없으면 "" */
function askVersion(sw: ServiceWorker): Promise<string> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(""), 3000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(typeof e.data === "string" ? e.data : "");
    };
    sw.postMessage("version", [channel.port2]);
  });
}

/** 설치 중인 새 워커가 다 받을(installed) 때까지 기다린다. 실패하면(redundant) false */
function settled(sw: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const done = () => {
      if (sw.state === "installed" || sw.state === "activated") resolve(true);
      else if (sw.state === "redundant") resolve(false);
      else return;
      sw.removeEventListener("statechange", done);
    };
    sw.addEventListener("statechange", done);
    done();
  });
}

/**
 * 지금 새 판이 있는지 확인한다. 있으면 받아 두고 새 판 안내를 띄운다 (바꾸기는 applyUpdate).
 * quiet면 정보 창의 상태 줄을 건드리지 않는다 (창으로 돌아올 때 하는 자동 확인)
 */
export async function checkForUpdate(quiet = false): Promise<void> {
  if (!registration) {
    if (!quiet) pwa.check = "unsupported";
    return;
  }
  if (!quiet) pwa.check = "checking";
  try {
    await registration.update();
    const installing = registration.installing;
    if (installing && !(await settled(installing))) throw new Error("install failed");
    pwa.lastChecked = Date.now();
    offer(registration.waiting);
    if (!quiet) pwa.check = waiting ? "idle" : "latest";
  } catch {
    if (!quiet) pwa.check = "failed";
  }
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
