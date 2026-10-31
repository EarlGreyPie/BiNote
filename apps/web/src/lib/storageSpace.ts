/**
 * 브라우저 저장 공간: 꽉 차서 못 적었는지 가려내고, 얼마나 쓰고 얼마나 남았는지 읽는다.
 * 남은 공간은 브라우저가 대강 알려 주는 값이라 "약"으로만 보인다.
 */

/** 저장 공간이 꽉 차서 난 오류인지 (IndexedDB·localStorage 공통. 파이어폭스 옛 이름도 본다) */
export function isQuotaError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22;
}

export interface StorageSpace {
  /** 이 사이트가 쓰는 바이트 */
  readonly usage: number;
  /** 이 사이트가 쓸 수 있는 바이트 (브라우저가 정한 대강의 한도) */
  readonly quota: number;
}

/** 쓰는 공간과 한도를 읽는다. 브라우저가 알려 주지 않으면 undefined */
export async function estimateSpace(storage: Pick<StorageManager, "estimate"> | undefined = globalThis.navigator?.storage): Promise<StorageSpace | undefined> {
  try {
    const got = await storage?.estimate?.();
    if (!got || typeof got.usage !== "number" || typeof got.quota !== "number" || !(got.quota > 0)) return undefined;
    return { usage: got.usage, quota: got.quota };
  } catch {
    return undefined;
  }
}

/** 남은 바이트 (0 아래로 내려가지 않는다) */
export function freeBytes(space: StorageSpace): number {
  return Math.max(0, space.quota - space.usage);
}

/** 바이트를 사람이 읽는 크기로 ("12 MB", "1.5 GB"). 1 MB보다 작으면 KB */
export function formatBytes(bytes: number): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${round(bytes / gb)} GB`;
  if (bytes >= mb) return `${round(bytes / mb)} MB`;
  return `${Math.max(0, Math.round(bytes / kb))} KB`;
}

/** 10 아래는 소수 한 자리, 그 위는 정수 */
function round(n: number): string {
  return n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n));
}
