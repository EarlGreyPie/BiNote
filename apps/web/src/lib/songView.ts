/**
 * 곡마다의 보기 상태. 곡을 열 때(새 악보, 파일 열기, MIDI 가져오기, 붙여넣기로 새 곡, 지난 작업 되살리기 —
 * 같은 작업 되살리기 포함) 모두 비우고, 보기 세대 번호를 하나 올린다. 롤·타브 보기는 이 번호로 새로 만들어지고,
 * 옛 보기가 늦게 알린 자리·커서는 이 번호로 버린다 (자동 보존용 작업 id와 따로: 같은 작업을 되살리면 작업 id는 같다).
 * 저장·다른 이름으로 저장·실행 취소·붙여넣기로 덧붙이기는 곡을 여는 것이 아니라 번호를 바꾸지 않는다
 */
export interface SongViewReset {
  /** 보기 세대 번호 (곡을 열 때마다 1씩) */
  readonly viewGen: number;
  /** 재생 위치·반복 구간(끄고 켜기용으로 기억한 구간 포함) */
  readonly cursor: undefined;
  readonly cursorExact: undefined;
  readonly loop: undefined;
  readonly loopStash: undefined;
  /** 타브 편집 커서 */
  readonly tabCursor: undefined;
  /** 이벤트 줄에서 고른 템포·마커, 열린 템포·마커 창 (마커 id는 곡마다 m1부터라 다른 곡의 같은 id를 가리킬 수 있다) */
  readonly pickedEvent: undefined;
  readonly eventEdit: undefined;
  /** 곡 검사에서 누른 트랙·자리, 음량 레인에 같이 그리던 트랙, 아래 편집기 칸에 고른 트랙 (모두 옛 트랙 id) */
  readonly reveal: undefined;
  readonly laneExtra: readonly string[];
  readonly extraChosen: readonly (string | undefined)[];
  readonly extraStamps: readonly (number | undefined)[];
  /** 옛 트랙·음을 들고 있는 창: 아르페지오·슬라이드·꾸밈음·트릴·음정 변환·화음↔트랙 정리·템포 한꺼번에·박자 */
  readonly arpeggio: undefined;
  readonly slide: undefined;
  readonly grace: undefined;
  readonly trill: undefined;
  readonly labDialog: undefined;
  readonly reverbDialog: undefined;
  readonly transposing: undefined;
  readonly voicing: undefined;
  readonly tempoChangeOpen: false;
  readonly tempoRampOpen: false;
  readonly meterOpen: false;
  /** 어긋난 길이 찾기 창 (옛 곡의 고칠 자리를 들고 있다) */
  readonly offgridOpen: false;
  /** 악보책 나누기 결과, 글자 수 줄이기 결과 글 */
  readonly split: undefined;
  readonly compactNote: "";
  /** MML로 내보내기 창에서 복사한 트랙 표시 (옛 트랙 id) */
  readonly exportCopied: undefined;
}

/** 곡을 열 때 새 곡에 남으면 안 되는 상태 (지금 세대 번호 → 다음 번호와 빈 값들) */
export function freshSongView(viewGen: number): SongViewReset {
  return {
    viewGen: viewGen + 1,
    cursor: undefined,
    cursorExact: undefined,
    loop: undefined,
    loopStash: undefined,
    tabCursor: undefined,
    pickedEvent: undefined,
    eventEdit: undefined,
    reveal: undefined,
    laneExtra: [],
    extraChosen: [],
    extraStamps: [],
    arpeggio: undefined,
    slide: undefined,
    grace: undefined,
    trill: undefined,
    labDialog: undefined,
    reverbDialog: undefined,
    transposing: undefined,
    voicing: undefined,
    tempoChangeOpen: false,
    tempoRampOpen: false,
    meterOpen: false,
    offgridOpen: false,
    split: undefined,
    compactNote: "",
    exportCopied: undefined,
  };
}
