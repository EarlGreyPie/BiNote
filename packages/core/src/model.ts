import type { Rat } from "./rat.js";

/** 곡 전체 하나의 템포 지도에 들어가는 변화. 편집기 안에서는 범위 제한이 없다. */
export interface TempoEvent {
  readonly at: Rat;
  readonly bpm: number;
}

export interface TimeSigEvent {
  readonly at: Rat;
  readonly beats: number;
  readonly unit: number;
}

export interface Marker {
  readonly id: string;
  readonly at: Rat;
  readonly label: string;
}

/**
 * 악기는 사운드팩 번호가 아니라 공통 ID로 저장한다.
 * 팩마다 같은 악기의 번호가 다르기 때문이다(기타 30/40 등).
 */
export interface InstrumentRef {
  readonly canonical: string;
  /**
   * 이 악기를 들을 사운드팩의 파일 이름 (트랙 편집기에서 고른 팩). 없으면 자동(설정의 위쪽 팩부터).
   * 그 이름의 팩이 지금 올라와 있지 않으면 자동처럼 찾되, 값은 지우지 않아 팩을 다시 올리면 그대로 쓴다
   */
  readonly packId?: string;
  readonly program?: number;
}

/** 악기 하나를 든 연주자. 화음 수 제한의 단위. */
export interface Player {
  readonly id: string;
  readonly name: string;
  readonly instrument: InstrumentRef;
  /**
   * 오르골·축음기 악보에서 다른 악기 트랙을 떼어 내 만든 악보면 원래 악보 id.
   * 원래 악보를 다시 보통 악기로 바꾸면 이 악보 트랙을 원래 악보로 돌려보낸다
   */
  readonly splitFrom?: string;
  /** 이 악보에 고른 타브 보기 튜닝(앱이 아는 이름)과 카포. 없으면 앱 기본 튜닝. 실행 취소·다시 실행을 곡과 함께 따른다 */
  readonly tab?: PlayerTab;
}

/** 악보 하나의 타브 튜닝 이름과 카포 (0~24) */
export interface PlayerTab {
  readonly tuning: string;
  readonly capo: number;
}

export interface Note {
  readonly id: string;
  readonly start: Rat;
  readonly dur: Rat;
  /** MIDI 음 번호 (o4c = 60) */
  readonly pitch: number;
  /** 프로필 범위의 v 값 */
  readonly vol: number;
  /** "next"면 & 로 다음 음과 잇는다 */
  readonly tie: "none" | "next";
  /** 타브에서 고른 줄 (1 = 가장 높은 줄). 타브 자동 배정이 이 줄을 먼저 지킨다. 소리·출력과는 상관없다 */
  readonly tabString?: number;
  /** 실험실 입력으로 만든 음의 표시 (프로젝트 파일에만 저장. 출력은 보통 v·높이 그대로). 풀면 처음 값으로 돌아간다 */
  readonly lab?: NoteLab;
}

/**
 * 실험실 표시. vol·pitch는 실험실 입력 전의 값 (풀기로 되돌린다).
 * 하모닉스 string·fret은 타브에서 만들었을 때 그 줄과 누른(자연이면 짚은) 프렛
 */
export type NoteLab =
  | { readonly kind: "ghost"; readonly vol: number }
  | {
      readonly kind: "harmonic";
      readonly type: "natural" | "artificial";
      readonly pitch: number;
      readonly vol: number;
      readonly string?: number;
      readonly fret?: number;
    };

/** 출력할 때 존중할 사용자 표기 습관. 비어 있으면 최적화기가 마음대로 고른다. */
export interface SpellingHints {
  readonly preferRelativeOctave?: boolean;
  readonly defaultLength?: number;
}

export type TrackRole = "melody" | "harmony" | "bass" | "free";

/**
 * 사용자가 쓴 MML 원문. 있으면 화면과 글자 수에 원문을 그대로 쓴다(쓴 사람의 표기를 바꾸지 않음).
 * 피아노롤처럼 음을 직접 고치는 편집은 원문을 지우고, 그때부터는 출력기가 다시 쓴다.
 */
export interface TrackText {
  readonly text: string;
  /** 마비꼬 startDelta처럼 원문 앞에 붙는 시작 위치 */
  readonly offset?: Rat;
}

/** 화음 하나 = 트랙 하나 = MML 채널 하나. 한 트랙은 동시에 한 음만 낸다. */
export interface Track {
  readonly id: string;
  readonly playerId: string;
  readonly name: string;
  readonly color: string;
  readonly role: TrackRole;
  readonly mute: boolean;
  readonly solo: boolean;
  /** 시작 위치 순, 서로 겹치지 않음 */
  readonly notes: readonly Note[];
  readonly spelling: SpellingHints;
  readonly mml?: TrackText;
  /**
   * 이 트랙만 다른 악기로 연주할 때. 없으면 악보(연주자) 악기를 쓴다.
   * 게임은 악보 하나(최대 6트랙)에 연주자 여럿이 들어가고 연주자마다 악기가 따로다
   * (첫 연주자 1~3트랙, 그다음부터 한 명이 1트랙씩)
   */
  readonly instrument?: InstrumentRef;
  /** 3MLE·마비꼬 파일의 채널 볼륨(0~127)·팬(0~127, 64 가운데). 편집기는 쓰지 않고 저장할 때 그대로 돌려준다 */
  readonly mix?: { readonly volume?: number; readonly pan?: number };
}

export interface SourceRef {
  readonly id: string;
  readonly kind: "audio" | "midi";
  readonly fileName: string;
  /** 원곡 시작과 MML 시작의 차이(초) */
  readonly offsetSec: number;
}

export interface SongMeta {
  readonly title: string;
  readonly author: string;
  readonly profileId: string;
  /** 3MLE 파일의 메모. 저장할 때 그대로 돌려준다 */
  readonly memo?: string;
}

export interface Song {
  readonly meta: SongMeta;
  readonly tempo: readonly TempoEvent[];
  readonly timeSig: readonly TimeSigEvent[];
  readonly markers: readonly Marker[];
  readonly players: readonly Player[];
  readonly tracks: readonly Track[];
  readonly sources: readonly SourceRef[];
}

/** 트랙이 실제로 쓰는 악기: 트랙에 따로 정했으면 그것, 아니면 악보 악기, 둘 다 없으면 피아노 */
export function trackInstrument(song: Pick<Song, "players">, track: Pick<Track, "playerId" | "instrument">): InstrumentRef {
  return track.instrument ?? song.players.find((p) => p.id === track.playerId)?.instrument ?? { canonical: "piano" };
}

export function emptySong(meta: SongMeta): Song {
  return { meta, tempo: [], timeSig: [], markers: [], players: [], tracks: [], sources: [] };
}
