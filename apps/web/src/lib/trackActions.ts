import type { Track } from "@mmlce/core";
import type { TrackViewState } from "./projectEditor";

/** 구조 목록·트랙 띠·오른쪽 클릭 메뉴가 같이 쓰는 트랙·악보 조작 */
export interface TrackActions {
  select(trackId: string): void;
  renameTrack(trackId: string, name: string): void;
  renamePlayer(playerId: string, name: string): void;
  playerInstrument(playerId: string, canonical: string): void;
  trackInstrument(trackId: string, canonical: string): void;
  /** 트랙에서 들을 사운드팩 (파일 이름, undefined면 자동). 악기 고르기와 같은 대상(트랙 악기 또는 악보 악기)에 적용 */
  trackPack(trackId: string, pack: string | undefined): void;
  /** 끄기·솔로 (듣는 방법이라 실행 취소에 안 들어간다) */
  listen(trackId: string, change: { mute?: boolean; solo?: boolean }): void;
  /** 눈(롤에서 숨김)·잠금(편집 막기). 실행 취소에 안 들어간다 */
  viewOf(trackId: string): TrackViewState;
  view(trackId: string, change: { hidden?: boolean; locked?: boolean }): void;
  remove(track: Track): void;
  /** 같은 악보 안에서 한 칸 위(-1)·아래(+1)로. 끝이면 false */
  canShift(trackId: string, step: -1 | 1): boolean;
  shift(trackId: string, step: -1 | 1): void;
  /** 연주자 playerId의 index번째 자리로 (옮길 트랙을 뺀 순서 기준) */
  move(trackId: string, playerId: string, index: number): void;
  /** 옮길 수 있는 악보(연주자)들. 못 옮기면 reason에 까닭 */
  moveTargets(trackId: string): readonly { readonly playerId: string; readonly label: string; readonly reason?: string | undefined }[];
  toNewScore(trackId: string): void;
  /** 복제본만 든 새 악보를 만든다 */
  copyToNewScore(trackId: string): void;
  duplicate(trackId: string): void;
  addTrack(): void;
  addScore(): void;
  /** 멜로디 트랙인지 (표시했거나 악보 첫 트랙), 표시 켜고 끄기 (실행 취소에 들어간다) */
  isMelody(trackId: string): boolean;
  setMelody(trackId: string, on: boolean): void;
  /** 지금 편집 중인(고른) 트랙인지. 음량 레인 메뉴 항목을 고른 트랙에는 안 띄운다 */
  isActive?: ((trackId: string) => boolean) | undefined;
  /** 음량 레인에 고른 트랙과 같이 그리는 트랙인지, 넣고 빼기 (트랙 목록 Ctrl+클릭, 터치는 길게 눌러 메뉴) */
  inLane?: ((trackId: string) => boolean) | undefined;
  toggleLane?: ((trackId: string) => void) | undefined;
  /** 이 트랙을 아래 편집기(편집기 둘 나란히)에 연다. 없으면 메뉴에 안 보인다 */
  openSecond?: ((trackId: string) => void) | undefined;
}
