import type { GameProfile, Song } from "@mmlce/core";
import { fewerBooks, planBooks, type BookPlan, type BookProgress, type FewerBooks } from "@mmlce/mml";

// 워커와 화면 쪽이 같이 쓰는 나누기 계산 (jobs.ts는 워커를 만들므로 워커가 불러오면 순환이 된다)

export interface SplitRequest {
  readonly song: Song;
  readonly profile: GameProfile;
  /** 나누기 전에 화음을 고르게 나눈다 */
  readonly spread: boolean;
  /** 꼼꼼히 나누기 */
  readonly thorough: boolean;
  /** 잠근 트랙 id (화음 분산에서 뺀다) */
  readonly locked?: readonly string[];
}

/** 악보책 나누기 (화음 고르게 나누기 → 나누기 → 꼼꼼히). 진행은 단계와 함께 알린다 */
export function planSplit({ song, profile, spread, thorough, locked }: SplitRequest, onProgress: (progress: BookProgress) => void): BookPlan {
  return planBooks(song, profile, { spread, thorough, onProgress, ...(locked?.length ? { locked: new Set(locked) } : {}) });
}

export interface BooksRequest {
  readonly song: Song;
  readonly profile: GameProfile;
  /** 지금 나눈 권 수 */
  readonly books: number;
  /** 잠근 트랙 id (음을 옮기지 않는다) */
  readonly locked?: readonly string[];
}

/** 화음을 고르게 나누면 권이 줄어드는지 (워커와 화면 쪽이 같이 쓴다) */
export function fewerOf({ song, profile, books, locked }: BooksRequest): FewerBooks | undefined {
  return fewerBooks(song, profile, books, locked?.length ? new Set(locked) : undefined);
}
