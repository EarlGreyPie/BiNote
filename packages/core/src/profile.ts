/**
 * 대상 게임마다 다른 숫자를 모아 둔 프로필.
 * 검사기·최적화기·분할기는 이 값만 읽으므로, 실측 결과나 게임 한도가 바뀌면
 * 여기 숫자만 고친다. PC 마비노기 기능은 `pc` 프로필에 FeatureModule로 붙인다.
 */
export interface GameProfile {
  readonly id: string;
  readonly label: string;
  readonly charLimitPerScore: number;
  readonly maxChordsPerPlayer: number;
  /** 악기마다 한 번에 내는 화음 수가 더 적으면 (오르골 3). 악보 하나에 이만큼씩 나눠 담는다 */
  readonly instrumentMaxChords: Readonly<Record<string, number>>;
  /**
   * 연주자가 아니라 장식품이 치는 악기 (오르골·축음기). 악보의 모든 트랙을 이 악기 하나로 치므로
   * 트랙마다 다른 악기를 줄 수 없다
   */
  readonly soloInstruments: readonly string[];
  /** 2단계 압축 목표 화음 수 후보 */
  readonly ensembleChordHint: readonly number[];
  readonly tempo: { readonly min: number; readonly max: number };
  readonly length: { readonly min: number; readonly max: number; readonly dots: number };
  /** o 명령으로 받아들이는 옥타브 (범위 밖이어도 오류 없음) */
  readonly octave: { readonly min: number; readonly max: number };
  /**
   * 실제로 그 높이로 소리 나는 음 범위 (MIDI 번호). 밖의 음은 오류 없이 옥타브째 접혀 범위 안에서 난다
   * (예: 피아노 o1c → o2c, o8b → o6b). 악기(canonical)별로 다르면 instrumentRanges에 둔다
   */
  readonly soundingRange: PitchRange;
  readonly instrumentRanges: Readonly<Record<string, PitchRange>>;
  readonly volume: { readonly min: number; readonly max: number };
  /** v 값마다 음량(dB). 길이는 volume.max - volume.min + 1 */
  readonly volumeCurve: readonly number[];
  /** 악보책에서 다음 악보로 넘어갈 때 더해지는 지연(ms). 모르면 null */
  readonly scoreBookGapMs: number | null;
  /** 악기(canonical)별 음색 경계. 경계 바로 위 음의 MIDI 번호 목록 */
  readonly sampleBoundaries: Readonly<Record<string, readonly number[]>>;
  /** 타악기(큰북·심벌즈)를 칠 때 쓰는 음 높이 (MIDI 번호). 큰북은 높이를 바꿔도 소리가 옮겨지지 않았다 */
  readonly percussionPitch: number;
  /**
   * 악기별 샘플 길이. 게임 샘플은 반복 없이 한 번 울리고 끝나서, 음을 길게 써도 이 길이 뒤로는 소리가 없다.
   * 구간(from = 그 구간 첫 음 MIDI 번호)마다 첫 음의 길이(초)를 두고, 위로 반음마다 2^(-1/12)배 짧아진다
   * (샘플을 빨리 돌려 높이를 올리므로). 맨 아래 구간은 아래로도 같은 식으로 늘린다. 없는 악기는 제한 없음
   */
  readonly sampleSeconds: Readonly<Record<string, readonly SampleZone[]>>;
  /**
   * 악기별 소리 줄어듦(감쇠). 구간(from = 그 구간 첫 음 MIDI 번호, sampleSeconds와 같은 구간)마다 그 첫 음이
   * 가장 큰 때(peakAt)와 처음 소리(startDb, 가장 클 때 기준), 가장 클 때보다 6·12·20·40dB 작아져 다시 커지지 않는
   * 시각(초, 친 때부터). 샘플이 끝날 때까지 그만큼 안 줄면 null (지속음 악기는 샘플 끝에서 끊긴다).
   * 길이처럼 구간 안에서 위로 반음마다 2^(-1/12)배 빨라진다. 없는 악기는 모름
   */
  readonly sampleDecay: Readonly<Record<string, readonly DecayZone[]>>;
  /**
   * 화음감쇠: 같은 v로 n음을 함께 치면 단음보다 perDoublingDb × log2(n) dB 커진다 (3dB면 음 에너지의 단순 합).
   * 화음의 v는 볼륨 곡선에서 그만큼 낮춘 값으로 고른다
   */
  readonly chordAttenuation: { readonly perDoublingDb: number };
  /** 게임에 붙여넣는 형식. "mml-at" = 악보 하나를 MML@트랙1,트랙2,...; 로 (PC와 같음, 2026-10-14 확인) */
  readonly clipboardFormat: "mml-at";
  /**
   * 트릴·트레몰로 창의 빠름 안내: 초당 이만큼보다 자주 다시 치면 게임에서 흐려진다고 알린다 (막지는 않는다).
   * 악기(canonical)별로 더 일찍 흐려지면 ornamentFastRateByInstrument에 둔다
   */
  readonly ornamentFastRate: number;
  readonly ornamentFastRateByInstrument: Readonly<Record<string, number>>;
  /**
   * 트릴·트레몰로 "전체 낮추기" 자동 값(v 단계): 빠르게 다시 치면 한 음보다 커지는 만큼. 한 음(single)과
   * 같은 연주자 화음을 함께 되풀이할 때(chord)
   */
  readonly ornamentRepeatLower: { readonly single: number; readonly chord: number };
  /**
   * &로 이은 다른 음을 다시 치지 않고 높이만 옮기는 최대 거리(반음). 더 멀면 새로 친다고 본다.
   * 재생(벤드)·악보 진단·트릴·꾸밈음·미끄러짐 창이 모두 이 값을 쓴다
   */
  readonly tieBendLimit: number;
  /**
   * 연주 누락음 위험 (실험실): 같은 악보에서 같은 샘플 구간 Z 안에 maxNoteMs보다 짧은 음을 minRun개 이상 쉼 없이(음 사이 틈 gapMs 미만)
   * 친 트랙이 minTracks개 이상이고, 그 연속이 같은 순간(착지 시각 차 gapMs 이내) gapMs보다 짧은 틈으로 다음 음(착지 음)에 넘어갈 때,
   * 구간 Z의 그 빠른 음과 그 순간 구간 Z에서 시작하는 음(빠른 음이 없던 트랙 음 포함)을 시각·악보 트랙 순으로 세어 maxStarts개를 넘는 음이
   * 게임에서 빠진다. 구간은 음색 경계(timbreBoundaries)로 나눈다. 이 규칙이 없는 게임이면 null. 고치기는 빠질 음을 gapMs 이상 늦춘다 (pending fastRunDrop)
   */
  readonly fastRunDrop: FastRunDropRule | null;
  /**
   * 아직 인게임 실측으로 확인하지 못한 항목. 그 항목에 걸린 값·동작은 임시 가정이다.
   * 검사기·창은 isPending·pendingItem으로 읽는다 (실측하면 목록에서 지우고 주석에 잰 날과 결과를 적는다)
   */
  readonly pending: readonly PendingItem[];
}

export interface FastRunDropRule {
  /** 같은 순간 이렇게 움직이는 트랙이 이만큼 이상이어야 한다 (한 트랙 안에서 되풀이하는 음은 빠지지 않았다) */
  readonly minTracks: number;
  /** 같은 구간의 빠른 음과 그 순간 시작하는 음을 차례로 세어 이만큼까지는 나고, 넘는 음부터 빠진다 */
  readonly maxStarts: number;
  /** 이보다 짧은(ms) 음을 빠른 음으로 본다 */
  readonly maxNoteMs: number;
  /** 빠른 음이 이만큼 이상 잇달아야 한다 */
  readonly minRun: number;
  /** 음 사이 틈이 이보다 짧으면(ms) 쉼 없이 이어진 것으로 본다. 같은 순간도 착지 시각 차가 이 안이면 같다고 본다 */
  readonly gapMs: number;
}

export interface SampleZone {
  readonly from: number;
  readonly seconds: number;
}

export interface DecayZone {
  readonly from: number;
  readonly peakAt: number;
  readonly startDb: number;
  readonly db6: number | null;
  readonly db12: number | null;
  readonly db20: number | null;
  readonly db40: number | null;
}

/** 감쇠 시각을 아는 깊이(dB). 이 밖은 앞뒤 점을 이어 어림한다 */
export const DECAY_STEPS = [6, 12, 20, 40] as const;

export interface PitchRange {
  readonly low: number;
  readonly high: number;
}

/** 실측 전 항목 이름. 실측을 마친 항목은 여기서도 지운다 (남겨 두면 검사기가 아직 모르는 것으로 읽는다) */
export type PendingKey =
  | "playerChannelSeparation"
  | "fourthTrackSound"
  | "mobileInstrumentPrograms"
  | "sampleDecay"
  | "tieBendLimit"
  | "trillVolumePattern"
  | "tempoChannelScope"
  | "lengthAfterTie"
  | "octaveCrossingAccidental"
  | "nCommand"
  | "fastRunDrop";

/**
 * 실측 전 항목이 걸린 곳.
 * - sound: 게임에서 나는 소리 (재생·소리 경고)
 * - syntax: 게임이 MML 글을 읽는 방법 (해석·출력)
 * - instrument: 악기 목록·번호
 */
export type PendingScope = "sound" | "syntax" | "instrument";

export interface PendingItem {
  readonly key: PendingKey;
  readonly scope: PendingScope;
  /** 이 악기(canonical)에만 걸리면 그 목록. 없으면 모든 악기 */
  readonly instruments?: readonly string[];
  /** 무엇을 아직 모르는지, 지금은 어떻게 가정하는지 */
  readonly note: string;
  /** 실측 전으로 적은 날 (YYYY-MM-DD) */
  readonly since: string;
}

/**
 * 인게임 실측(2026-08-23, MMLCS): 피아노·류트·기타 v1~v15 녹음 45점이
 * dB = 40·log10(v/15)에 잔차 RMS 0.06dB로 맞았다. 세기 = v×127/15에 DLS 기본 곡선을
 * 쓴 것과 같다(게임이 따로 곡선을 쓰지 않음). v0은 소리 없음.
 */
function measuredCurve(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) =>
    i + min === 0 ? -Infinity : 40 * Math.log10((i + min) / max),
  );
}

// DLS 분석: 피아노·류트·하프는 o3d+|o3e, o4d+|o4e, o5e|o5f 근처에서 샘플이 바뀐다.
// 인게임에서도 e 근처 음색 튐을 확인함(2026-10-14).
const E_BOUNDARIES = [52, 64, 77];

/*
 * 인게임 실측 (2026-10-14, 게임 CLI로 연주하며 PC 출력 녹음, 피아노 기준):
 * - 화음(c·e·g, 3화음 악기 9종): 같은 v에서 3음 화음은 단음 c보다 류트 4.3·만돌린 5.4·하모니카 4.1·플루트 4.7·
 *   바이올린 4.3·샬루모 4.7dB 커서 음 에너지의 단순 합(4.8dB)과 맞는다 → 2배마다 3dB.
 *   피아노 2.5·하프 2.7·포크 기타 7.0dB은 음마다 샘플 크기가 달라서다 (피아노 o4e~o5e는 다른 음보다 4~5dB 작다).
 *   1화음 악기(그냥 "피아노")는 첫 트랙만 소리 나고, 3화음 악기는 4트랙 악보에서도 ChannelCount 3 (4번째 트랙이 나는지는 미확인, pending fourthTrackSound).
 * - 악보책: 2초짜리 악보가 3.01초마다 반복(14회, ±20ms) → 지연 1010ms. 악보 하나 반복은 틈 없음.
 * - 옥타브: o0~o9 모두 오류 없음(o0c도 소리 남). 범위 밖 음은 옥타브째 접혀 범위 안에서 난다.
 *   보유 악기 33종을 흰건반으로 훑음(경계 ±1반음): 피아노·류트·하프·기타 o1e~o7e, 만돌린 o1f~, 플루트·샬루모 o2f~,
 *   고양이 하모니카 o4a~ (o1c → o5c). 위 끝은 모두 o7e. 스킨만 다른 악기는 결과가 같았다.
 *   바이올린·하모니카도 o1e부터(반음씩 친 녹음에서 o1c~o1d+만 옥타브 위 음과 같은 소리). 실로폰은 적은 범위는 같고
 *   소리가 한 옥타브 위로 나는데, 이건 사운드팩 샘플이 그렇게 들어 있어 미리듣기에서 따로 옮기지 않는다.
 * - v0 무음, v1은 v15보다 47dB 작음 (곡선 그대로). 피아노 v15·v5 음색(스펙트럼 모양) 같음 → 세기별 샘플 없음.
 * - 같은 음 붙임(c&v5c): & 뒤 v는 무시되고 다시 치지 않는다.
 * - 다른 음 붙임(c&d): 다시 치지 않고 붙임 자리에서 높이만 바로 바뀐다(미끄러지지 않음). 새 음의 샘플 구간으로
 *   바꿔 타되 재생 위치(샘플 안 시각)는 이어 간다. 그래서 소리가 끝나는 때는 그 위치가 새 샘플 끝에 닿을 때다
 *   (c&d 3.19초, c&>c 3.36초, d+&e 3.51초, c&g 3.8초가 이 식과 0.05초 안에서 맞음).
 * - 샘플 길이(음마다 6초로 친 녹음 o1e~o7e, 11종): 반복 구간이 없어 샘플이 끝나면 소리도 끝난다. 지속음 악기(플루트 등)도 같다. 구간 안에서 위로 갈수록
 *   반음마다 2^(-1/12)배 짧아지고 음색 경계(o3e·o4e·o5f)에서 다시 길어진다. 식과 실측 차이 0.1초 이내.
 *   이음 길이나 템포와 상관없이 첫 음을 친 때부터 샘플 길이에서 끝난다(같은 음 20초 이음도 o4c 피아노 3.3초).
 *   고양이 하모니카는 샘플이 0.4~0.7초로 아주 짧다. 오르골(하우징 가구로 직접 재생해 녹음)은 o1e~o7e, 샘플 1.8~5초.
 *   샬루모는 o2f·o2f+가 같은 샘플이라 맨 아래 구간이 o2f+(42) 샘플이다 (6초 녹음, 2026-10-22). 축음기 o4f·o5g 경계도 이날 녹음으로 확인.
 *   오르골 맨 위 구간은 o6f(89)부터 (녹음 다시 확인, 2026-10-22). 처음 o6f+(90)로 넣어 1.97초는 o6f+ 값이라 o6f 기준 2.09초로 옮김.
 *   플루트 가운데 구간은 o5d+(75)부터 (2026-10-31): 반음씩 친 음계에서 배음 모양이 o5d → o5d+에서만 튀고, 6초 녹음은
 *   o5d 1.51초(아래 구간 식과 맞음)·o5d+ 5.71초·o5e 5.39초. 처음 o5e(76)로 넣었던 것을 옮기고, 감쇠 시각은 o5e 값을 2^(1/12)배 해 o5d+ 기준으로 옮김.
 *   바이올린 맨 위 구간은 o5c+(73)부터 (2026-10-31, 반음씩 친 음계): 배음 모양이 o5c → o5c+에서만 12.7dB 튄다.
 *   처음 o5d(74)로 넣었던 것을 옮기고, 샘플 길이·감쇠 시각은 o5d 값을 2^(1/12)배 해 o5c+ 기준으로 옮김.
 *   2026-10-31 반음 음계·6초 녹음으로 재확인: 플루트 맨 위 o6d+(87), 샬루모 o3g(55)·o4a(69)(o5a+ 82는 그대로),
 *   실로폰·오르골 o4f(65)·o5g(79), 고양이 하모니카 o5g(79)·o5b(83). 모두 처음 넣은 값보다 한 반음 아래가 구간 첫 음이다.
 * - 음색 경계 위 e를 붙이면 한 번만 치고 이어진다 (튐 없음).
 * - 축음기(하우징 가구, 2026-10-16 직접 재생해 녹음): 오르골처럼 악보 하나에 3트랙. o1e~o7e(28~100), 범위 밖은 옥타브째 접힌다.
 *   줄지 않는 지속음인데 샘플이 끝나면 끊긴다(4.5~5.3초). 구간 경계 51|52·88|89는 반음씩 친 녹음의 음색 변화로,
 *   64|66·78|80은 6초 녹음 길이로 확인했다. 65·79는 위 구간 첫 음이 맞다(2026-10-22 녹음으로 확인). 식과 실측 차이 0.01초 이내.
 */
export const MOBILE_PROFILE: GameProfile = {
  id: "mobile",
  label: "마비노기 모바일",
  charLimitPerScore: 2400,
  maxChordsPerPlayer: 6,
  instrumentMaxChords: { "music-box": 3, gramophone: 3 },
  soloInstruments: ["music-box", "gramophone"],
  ensembleChordHint: [6, 12, 18, 24],
  tempo: { min: 32, max: 255 },
  length: { min: 1, max: 64, dots: 1 },
  octave: { min: 0, max: 9 },
  soundingRange: { low: 28, high: 100 },
  instrumentRanges: {
    mandolin: { low: 29, high: 100 },
    flute: { low: 41, high: 100 },
    chalumeau: { low: 41, high: 100 },
    "cat-harmonica": { low: 69, high: 100 },
  },
  volume: { min: 0, max: 15 },
  volumeCurve: measuredCurve(0, 15),
  scoreBookGapMs: 1010,
  sampleBoundaries: { piano: E_BOUNDARIES, lute: E_BOUNDARIES, harp: E_BOUNDARIES },
  percussionPitch: 60,
  // 플루트 맨 위·샬루모·실로폰·오르골·고양이 하모니카 경계: 2026-10-31 반음 음계·6초 녹음으로 재확인 (한 반음 아래로 옮김)
  sampleSeconds: {
    piano: [{ from: 40, seconds: 5.31 }, { from: 52, seconds: 5.3 }, { from: 64, seconds: 5.29 }, { from: 77, seconds: 5.04 }, { from: 89, seconds: 4.99 }],
    lute: [{ from: 38, seconds: 5.8 }, { from: 52, seconds: 4.8 }, { from: 64, seconds: 5.24 }, { from: 77, seconds: 4.86 }],
    mandolin: [{ from: 38, seconds: 5.67 }, { from: 52, seconds: 5.13 }, { from: 64, seconds: 4.98 }, { from: 77, seconds: 4.94 }],
    harp: [{ from: 40, seconds: 5.26 }, { from: 52, seconds: 5.23 }, { from: 64, seconds: 5.02 }, { from: 77, seconds: 4.33 }, { from: 89, seconds: 4.4 }],
    "folk-guitar": [{ from: 40, seconds: 5.26 }, { from: 52, seconds: 5.26 }, { from: 64, seconds: 5.27 }, { from: 77, seconds: 4.44 }, { from: 89, seconds: 4.67 }],
    xylophone: [{ from: 28, seconds: 5.26 }, { from: 52, seconds: 2.66 }, { from: 65, seconds: 2.39 }, { from: 79, seconds: 2.2 }],
    flute: [{ from: 52, seconds: 5.35 }, { from: 75, seconds: 5.71 }, { from: 87, seconds: 5.69 }],
    violin: [{ from: 50, seconds: 5.49 }, { from: 60, seconds: 4.58 }, { from: 66, seconds: 4.9 }, { from: 73, seconds: 4.71 }],
    chalumeau: [{ from: 42, seconds: 5.67 }, { from: 55, seconds: 5.4 }, { from: 69, seconds: 4.84 }, { from: 82, seconds: 4.56 }],
    harmonica: [{ from: 40, seconds: 5.25 }, { from: 52, seconds: 5.28 }, { from: 64, seconds: 5.27 }, { from: 77, seconds: 4.97 }, { from: 89, seconds: 4.99 }],
    "music-box": [{ from: 28, seconds: 5.05 }, { from: 52, seconds: 2.24 }, { from: 65, seconds: 2.17 }, { from: 79, seconds: 1.9 }, { from: 89, seconds: 2.09 }],
    gramophone: [{ from: 40, seconds: 5.33 }, { from: 52, seconds: 5.33 }, { from: 65, seconds: 5.02 }, { from: 79, seconds: 4.47 }, { from: 89, seconds: 5.02 }],
    "cat-harmonica": [{ from: 28, seconds: 0.47 }, { from: 32, seconds: 0.74 }, { from: 44, seconds: 0.73 }, { from: 56, seconds: 0.72 }, { from: 68, seconds: 0.74 }, { from: 79, seconds: 0.42 }, { from: 83, seconds: 0.42 }],
  },
  // BINOTE DLS Pack v0.3 샘플(= 게임 6초 녹음을 구간마다 한 음씩 자른 것)을 20ms RMS로 잼 (2026-10-27). 구간 첫 음 기준으로 옮김.
  // 같은 날 게임 녹음 약 380음(구간 첫 음이 아닌 음)과 견줌: 끝나는 때 중앙값 0.001초, 12·20·40dB 시각은 거의 ±5% 안 →
  // 구간마다 한 샘플을 높이만큼 빠르게 돌리는 식이 맞다. 하프 6dB(최대 0.6초 늦음)·류트 맨 위 40dB·만돌린 o3e 12dB·오르골 12dB만
  // 0.1~0.2초 어긋나고 20dB 뒤는 맞는다. 고양이 하모니카(샘플 0.5초)와 타악기(2초 녹음뿐)는 넣지 않음
  sampleDecay: {
    lute: [
      { from: 38, peakAt: 0.07, startDb: -2.84, db6: 0.5, db12: 1.26, db20: 2.62, db40: 5.38 },
      { from: 52, peakAt: 0.03, startDb: -1.06, db6: 0.28, db12: 0.62, db20: 1.16, db40: 2.52 },
      { from: 64, peakAt: 0.07, startDb: -0.75, db6: 0.22, db12: 0.42, db20: 0.92, db40: 2.14 },
      { from: 77, peakAt: 0.01, startDb: -2.08, db6: 0.06, db12: 0.21, db20: 0.38, db40: 2.37 },
    ],
    mandolin: [
      { from: 38, peakAt: 0.25, startDb: -13.05, db6: 0.5, db12: 0.74, db20: 1.52, db40: 5.44 },
      { from: 52, peakAt: 0.05, startDb: -5.98, db6: 0.34, db12: 2.42, db20: 4.74, db40: 4.96 },
      { from: 64, peakAt: 0.01, startDb: -0.77, db6: 0.24, db12: 0.9, db20: 2.08, db40: 4.8 },
      { from: 77, peakAt: 0.12, startDb: -4.18, db6: 0.34, db12: 0.49, db20: 0.91, db40: 4.45 },
    ],
    flute: [
      { from: 52, peakAt: 0.23, startDb: -16.44, db6: 5.06, db12: 5.2, db20: 5.26, db40: null },
      { from: 75, peakAt: 0.2, startDb: -6.65, db6: 5.66, db12: 5.66, db20: 5.68, db40: null },
      { from: 87, peakAt: 0.12, startDb: -4.38, db6: 5.66, db12: 5.66, db20: 5.68, db40: 5.68 },
    ],
    chalumeau: [
      { from: 42, peakAt: 0.21, startDb: -4.91, db6: 5.6, db12: 5.6, db20: 5.62, db40: null },
      { from: 55, peakAt: 0.37, startDb: -2.32, db6: 5.3, db12: 5.32, db20: 5.34, db40: 5.36 },
      { from: 69, peakAt: 0.05, startDb: -1.49, db6: 4.28, db12: 4.77, db20: null, db40: null },
      { from: 82, peakAt: 0.09, startDb: -1.08, db6: 4.26, db12: 4.5, db20: 4.52, db40: null },
    ],
    piano: [
      { from: 40, peakAt: 0.05, startDb: -2.62, db6: 0.56, db12: 1.18, db20: 2.32, db40: null },
      { from: 52, peakAt: 0.03, startDb: -1.28, db6: 0.4, db12: 0.88, db20: 2.5, db40: null },
      { from: 64, peakAt: 0.01, startDb: -0.19, db6: 0.26, db12: 0.68, db20: 1.32, db40: null },
      { from: 77, peakAt: 0.03, startDb: -0.41, db6: 0.28, db12: 0.44, db20: 0.66, db40: 4.98 },
      { from: 89, peakAt: 0.03, startDb: -0.94, db6: 0.13, db12: 0.21, db20: 0.3, db40: 4.77 },
    ],
    violin: [
      { from: 50, peakAt: 0.73, startDb: -12.51, db6: 5.24, db12: 5.36, db20: 5.4, db40: 5.48 },
      { from: 60, peakAt: 0.59, startDb: -14.33, db6: 4.42, db12: 4.5, db20: 4.54, db40: null },
      { from: 66, peakAt: 0.65, startDb: -9.53, db6: 4.7, db12: 4.78, db20: 4.8, db40: 4.88 },
      { from: 73, peakAt: 0.65, startDb: -8.63, db6: 4.7, db12: 4.73, db20: null, db40: null },
    ],
    harp: [
      { from: 40, peakAt: 0.03, startDb: -1.61, db6: 1.14, db12: 3.58, db20: 4.34, db40: 5.02 },
      { from: 52, peakAt: 0.03, startDb: -1.55, db6: 0.38, db12: 1.7, db20: 3.5, db40: 4.76 },
      { from: 64, peakAt: 0.01, startDb: -0.52, db6: 0.34, db12: 0.76, db20: 2.14, db40: 4.34 },
      { from: 77, peakAt: 0.03, startDb: -0.5, db6: 0.08, db12: 0.17, db20: 0.81, db40: 3.43 },
      { from: 89, peakAt: 0.01, startDb: -1.18, db6: 0.15, db12: 0.3, db20: 1.06, db40: 4.03 },
    ],
    "music-box": [
      { from: 28, peakAt: 0.05, startDb: -3.54, db6: 0.18, db12: 1.2, db20: 3.7, db40: 4.2 },
      { from: 52, peakAt: 0.01, startDb: -2.96, db6: 0.02, db12: 0.6, db20: 1.4, db40: 2.06 },
      { from: 65, peakAt: 0.01, startDb: -0.58, db6: 0.61, db12: 1.0, db20: 1.48, db40: 1.95 },
      { from: 79, peakAt: 0.01, startDb: -0.45, db6: 0.34, db12: 1.04, db20: 1.59, db40: 1.8 },
      { from: 89, peakAt: 0.01, startDb: -2.27, db6: 0.04, db12: 0.13, db20: 0.59, db40: 1.93 },
    ],
    "folk-guitar": [
      { from: 40, peakAt: 0.05, startDb: -2.14, db6: 0.34, db12: 1.74, db20: 3.84, db40: 4.86 },
      { from: 52, peakAt: 0.03, startDb: -1.12, db6: 0.6, db12: 1.74, db20: 3.92, db40: 5.04 },
      { from: 64, peakAt: 0.05, startDb: -0.8, db6: 0.6, db12: 1.04, db20: 3.68, db40: 4.96 },
      { from: 77, peakAt: 0.03, startDb: -0.85, db6: 0.25, db12: 0.49, db20: 0.95, db40: 2.35 },
      { from: 89, peakAt: 0.01, startDb: -0.49, db6: 0.11, db12: 0.17, db20: 0.61, db40: 3.94 },
    ],
    harmonica: [
      { from: 40, peakAt: 1.91, startDb: -8.4, db6: 4.24, db12: 4.58, db20: 4.9, db40: 5.2 },
      { from: 52, peakAt: 2.21, startDb: -8.85, db6: 4.18, db12: 4.54, db20: 4.8, db40: 5.16 },
      { from: 64, peakAt: 0.09, startDb: -6.76, db6: 4.34, db12: 4.66, db20: 4.9, db40: 5.2 },
      { from: 77, peakAt: 0.05, startDb: -2.49, db6: 3.69, db12: 4.24, db20: 4.53, db40: 4.87 },
      { from: 89, peakAt: 1.81, startDb: -5.65, db6: 3.67, db12: 4.26, db20: 4.58, db40: 4.89 },
    ],
    gramophone: [
      { from: 40, peakAt: 3.29, startDb: -6.99, db6: 4.54, db12: 4.84, db20: 5.1, db40: 5.26 },
      { from: 52, peakAt: 2.55, startDb: -7.7, db6: 4.76, db12: 4.94, db20: 5.1, db40: 5.26 },
      { from: 65, peakAt: 0.92, startDb: -3.7, db6: 4.49, db12: 4.7, db20: 4.83, db40: 4.98 },
      { from: 79, peakAt: 1.39, startDb: -11.12, db6: 3.5, db12: 3.92, db20: 4.2, db40: 4.41 },
      { from: 89, peakAt: 2.91, startDb: -10.76, db6: 4.36, db12: 4.64, db20: 4.79, db40: 4.96 },
    ],
    xylophone: [
      { from: 28, peakAt: 0.13, startDb: -5.7, db6: 1.54, db12: 2.32, db20: 3.28, db40: 4.8 },
      { from: 52, peakAt: 0.03, startDb: -1.0, db6: 0.9, db12: 1.3, db20: 1.76, db40: 2.48 },
      { from: 65, peakAt: 0.2, startDb: -1.82, db6: 0.59, db12: 0.89, db20: 1.25, db40: 2.01 },
      { from: 79, peakAt: 0.01, startDb: -0.59, db6: 0.42, db12: 0.76, db20: 1.17, db40: 1.91 },
    ],
  },
  chordAttenuation: { perDoublingDb: 3 },
  clipboardFormat: "mml-at",
  // 트레몰로 실측(2026-10-27, 피아노·류트·만돌린·바이올린·플루트·하프): 뜯는 악기는 초당 16번까지 다시 치는 게 들리고
  // 20번 넘으면 흐려지며 27번부터 거의 한 음. 바이올린·플루트는 12번에서 이미 약하고 16번부터 거의 안 들림
  ornamentFastRate: 20,
  ornamentFastRateByInstrument: { violin: 12, flute: 12 },
  // 같은 실측: 한 음을 l64로 되풀이하면 한 음보다 약 7dB, 세 음 화음을 l32로 되풀이하면 그냥 화음보다 약 10dB 커지고 줄지 않는다.
  // 다 맞추면 너무 작아져(같은 v로 쳐도 음마다 4~9dB 흔들림) 권장값은 그 절반쯤
  ornamentRepeatLower: { single: 3, chord: 5 },
  // c&>c(12반음)·c&g까지는 다시 치지 않음을 확인했다(2026-10-14). 24는 재생의 벤드 범위에 맞춘 가정 (pending tieBendLimit)
  tieBendLimit: 24,
  // 음씹힘 재현 실험(2026-10-31, 모바일, 피아노·류트, 아리아 한 곡에서 잘라 낸 판들. dev docs/NOTE_DROP_RESEARCH.md 6.6절):
  // t116 24분음표(86ms)·16분음표(129ms) 둘 뒤 화음은 빠지고 t60 24분음표(167ms)는 나옴 → 경계 150ms.
  // 트랙 3개는 빠지고 2개는 나옴, 짧은 음 하나는 나옴, 착지 음 앞 r64(t116 32ms)는 나옴.
  // 같은 날 이어진 시험: 꾸밈음(o3e~o4d+ 구간)은 그대로 두고 착지 화음만 다른 구간(o4a+·o5d+·o5f)으로 옮기면 나오고, 같은 구간
  // (o4c+·o4d+·o3g+)이면 빠짐. 꾸밈음만 한 옥타브 위(o4e~ 구간)로 옮기면 그 구간의 착지 음 E4만 빠지고 C4·G3은 나옴.
  // 볼륨은 상관없었다 → 빠른 음 연속과 같은 샘플 구간의 착지 음만 빠진다 (pending fastRunDrop)
  // 이어서 잰 것(같은 날): 트랙 2개 × 빠른 음 3개(합 6)도 빠지고, 트랙 2개 × 2개(합 4)는 나온다 → 트랙 수보다 같은 구간의 빠른 음
  // 합이 기준이다. 계속 울리던 같은 구간 음을 빼도, 화면 30·60fps에서도 똑같이 빠졌다.
  // 세 번째 시험(같은 날): 합 5(트랙 2개 × 3·2개, 트랙 3개 × 2·2·1개)도 빠짐 → 기준 5, 빠른 음 하나뿐인 트랙도 합에 든다.
  // 꾸밈음 없이 쉼표 뒤 같은 순간 친 같은 구간 음(트랙 5의 G3)도 함께 빠짐 → 착지 음만이 아니라 그 순간 그 구간에서 시작하는 음이 모두 빠진다.
  // 아리아 62마디(o4e~o5d+ 구간 꾸밈음 6개 → 화음 C5·E5·G4)는 예측대로 셋 다 빠짐. 실로폰은 구간(o3e~o4f)대로 피아노에선 살던 E4까지 빠짐,
  // 바이올린은 구간이 갈려 빠지지 않음(예측대로). 플루트는 한 구간인데도 빠지지 않음(계속 울리는 악기는 다를 수 있어 아직 판단 보류).
  // 62마디 착지 음을 r64(t114 33ms) 늦추면 C5·E5는 살고 G4는 여전히 빠짐, r48(44ms)·r32(66ms)는 셋 다 남 → 틈 기준을 40ms로 올림
  // (t116 r64 32ms는 38마디에서 살았지만 아슬아슬해 위험으로 본다).
  // 네 번째 시험(같은 날): 합 4(트랙 2개 × 2개, 6트랙 판)는 트랙 1의 C4는 살고 트랙 5의 G3은 빠짐 → 빠른 음과 그 순간 시작하는 음을
  // 트랙 순으로 세어 5개까지 나고 6번째부터 빠진다(합 4 + C4 = 5 남, + G3 = 6 빠짐. 트랙 2개뿐인 판의 합 4 + C4 = 5도 남았다).
  // 두 옥타브 올린 A판: 바이올린(o5c+ 이상 한 구간)은 셋 다 빠지고, 플루트는 o6e 경계 아래 C6·G5만 빠지고 E6은 남음 → 계속 울리는 악기도 같다.
  // 낮은 A판과 플루트 경계 판(o3d~o3f+ 꾸밈음 6개 뒤 G3~E4)에서 플루트 o5d 아래는 빠지지 않았다. 그 음역은 샘플 하나(o5d 1.51초가
  // 샘플 길이 식과 맞음)라 경계 때문은 아니다. 까닭은 아직 모른다 (dev docs/NOTE_DROP_RESEARCH.md 6.6.6절).
  // 큰북은 트랙 셋 × 빠른 음 2개 뒤 착지도 났다 → 타악기는 세지 않는다 (검사기 fastRunMoments)
  fastRunDrop: { minTracks: 2, maxStarts: 5, maxNoteMs: 150, minRun: 1, gapMs: 40 },
  // 실측으로 확인한 볼륨 곡선·악기별 음역·트레몰로 빠르기는 넣지 않는다 (위 주석에 잰 날과 결과)
  pending: [
    {
      key: "playerChannelSeparation",
      scope: "sound",
      note: "연주자(악보)마다 소리 채널이 따로인지. 여러 연주자가 같은 악기로 같은 음을 함께 쳐도 서로 끊지 않는다고 본다",
      since: "2026-10-31",
    },
    {
      key: "fourthTrackSound",
      scope: "sound",
      note: "3화음 악기로 4트랙 이상인 악보를 칠 때 4번째 트랙부터 소리가 나는지 (ChannelCount는 3). 지금은 나는 것으로 본다",
      since: "2026-10-14",
    },
    {
      key: "mobileInstrumentPrograms",
      scope: "instrument",
      instruments: ["folk-guitar", "harmonica", "cat-harmonica", "gramophone"],
      note: "모바일 전용 악기의 게임 안 악기 번호. 사운드팩마다 번호가 달라 이름으로만 찾는다",
      since: "2026-10-31",
    },
    {
      key: "sampleDecay",
      scope: "sound",
      instruments: ["cat-harmonica", "bass-drum", "cymbal"],
      note: "소리 줄어듦(감쇠). 고양이 하모니카는 샘플이 0.5초로 짧고 타악기는 2초 녹음뿐이라 넣지 않았다. 줄지 않는다고 본다",
      since: "2026-10-27",
    },
    {
      key: "tieBendLimit",
      scope: "sound",
      note: "&로 이은 다른 음을 다시 치지 않는 최대 높이 차. 12반음까지 확인했고, 그보다 먼 음은 24반음까지 같다고 본다",
      since: "2026-10-31",
    },
    {
      key: "trillVolumePattern",
      scope: "sound",
      note: "트릴·트레몰로 창의 v 모양(번갈아·첫 음 세게·점점 크게 등)이 게임에서 어떻게 들리는지",
      since: "2026-10-31",
    },
    {
      key: "tempoChannelScope",
      scope: "syntax",
      note: "악보 안 어느 채널에 쓴 t든 그 악보 모든 채널에 걸리는지. 지금은 그렇다고 보고 템포 자리를 고른다",
      since: "2026-10-31",
    },
    {
      key: "lengthAfterTie",
      scope: "syntax",
      note: "& 뒤에 l 같은 명령이 끼어도(c&l8c) 두 음이 이어지는지. 지금은 이어진다고 읽고, 출력기는 &와 음 사이에 l을 쓰지 않는다",
      since: "2026-10-31",
    },
    {
      key: "octaveCrossingAccidental",
      scope: "syntax",
      note: "b+·c-가 옥타브를 넘어 위 c·아래 b로 나는지. 지금은 넘는다고 읽고, 글자 수 줄이기도 옥타브 경계 음을 b+·c-로 쓴다(끄는 옵션 있음)",
      since: "2026-10-31",
    },
    {
      key: "nCommand",
      scope: "syntax",
      note: "n 명령이 같은 높이 음표와 소리(볼륨·음색)가 같은지. 같은지 몰라 출력기는 n을 새로 쓰지 않는다",
      since: "2026-10-31",
    },
    {
      key: "fastRunDrop",
      scope: "sound",
      note:
        "같은 악보에서 같은 샘플 구간에 150ms보다 짧은 음을 쉼 없이 친 트랙이 2개 이상이고 같은 순간 40ms보다 짧은 틈으로 넘어가면, " +
        "그 구간의 빠른 음과 그 순간 시작하는 음(다른 트랙 음 포함)을 트랙 순으로 세어 5개를 넘는 음이 빠지는지와 그 기준값. " +
        "피아노·류트·실로폰·바이올린·플루트로 확인했다. 틈 40ms는 33ms에서 하나가 빠지고 44ms에서 모두 난 데서 잡은 여유값이다. " +
        "플루트 o5d 아래는 빠른 음 6개 뒤에도 빠지지 않았다(샘플 하나인 음역이라 경계 때문은 아니고 까닭은 모름). 지금은 그대로 알린다. 빠른 음 자체가 빠지는지는 재지 않았다. " +
        "타악기는 큰북으로 재 보니 빠지지 않아 세지 않는다(심벌즈는 판정 못 함). 같은 높이를 여러 트랙이 잇달아 칠 때는 재지 않았다. " +
        "구간 경계를 재지 않은 악기(타악기 등)는 전체를 한 구간으로 본다",
      since: "2026-10-31",
    },
  ],
};

export const PROFILES: Readonly<Record<string, GameProfile>> = {
  [MOBILE_PROFILE.id]: MOBILE_PROFILE,
};

/** 이 악기가 그 높이로 소리 내는 범위 */
export function soundingRangeOf(profile: GameProfile, instrument: string | undefined): PitchRange {
  return (instrument !== undefined ? profile.instrumentRanges[instrument] : undefined) ?? profile.soundingRange;
}

/** 범위 밖 음을 게임처럼 옥타브째 접는다. 범위는 한 옥타브 이상이어야 한다 */
export function foldPitch(pitch: number, range: PitchRange): number {
  let p = pitch;
  while (p < range.low) p += 12;
  while (p > range.high) p -= 12;
  return p;
}

/** 이 높이(접힌 뒤)를 내는 샘플 구간. 모르면 undefined */
export function sampleZoneAt(profile: GameProfile, instrument: string | undefined, pitch: number): SampleZone | undefined {
  const zones = instrument !== undefined ? profile.sampleSeconds[instrument] : undefined;
  if (!zones || zones.length === 0) return undefined;
  let zone = zones[0]!;
  for (const z of zones) if (z.from <= pitch) zone = z;
  return zone;
}

/** 이 악기에서 이 높이(접힌 뒤)의 음이 소리 나는 최대 길이(초). 모르면 undefined */
export function sampleSecondsAt(profile: GameProfile, instrument: string | undefined, pitch: number): number | undefined {
  const zones = instrument !== undefined ? profile.sampleSeconds[instrument] : undefined;
  if (!zones || zones.length === 0) return undefined;
  let zone = zones[0]!;
  for (const z of zones) if (z.from <= pitch) zone = z;
  return zone.seconds * 2 ** (-(pitch - zone.from) / 12);
}

/**
 * 이 악기에서 게임이 샘플(음색)을 바꾸는 경계 (경계 바로 위 음의 MIDI 번호, 작은 순). 실측한 샘플 길이 구간의 시작(sampleSeconds)과
 * 음색 경계(sampleBoundaries)를 합친다. &로 이은 음이 경계를 넘으면 게임은 새 구간 샘플로 바꿔 타서 음색이 튄다
 */
export function timbreBoundaries(profile: GameProfile, instrument: string | undefined): number[] {
  if (instrument === undefined) return [];
  const zones = profile.sampleSeconds[instrument] ?? [];
  const all = new Set([...zones.slice(1).map((z) => z.from), ...(profile.sampleBoundaries[instrument] ?? [])]);
  return [...all].sort((a, b) => a - b);
}

/** 두 높이(접기 전)를 &로 이으면 음색 경계를 넘는지. 재생처럼 악기 범위로 접은 높이로 잰다 */
export function crossesTimbre(profile: GameProfile, instrument: string | undefined, a: number, b: number): boolean {
  const range = soundingRangeOf(profile, instrument);
  const lo = Math.min(foldPitch(a, range), foldPitch(b, range));
  const hi = Math.max(foldPitch(a, range), foldPitch(b, range));
  return timbreBoundaries(profile, instrument).some((x) => lo < x && x <= hi);
}

/** 이 항목이 아직 실측 전인지. instrument를 주면 그 악기에 걸리는지까지 본다 (악기 목록이 없는 항목은 모든 악기) */
export function isPending(profile: GameProfile, key: PendingKey, instrument?: string): boolean {
  return pendingItem(profile, key, instrument) !== undefined;
}

/** 실측 전 항목의 설명 (창·검사기 안내에 쓴다). 실측했거나 그 악기에 걸리지 않으면 undefined */
export function pendingItem(profile: GameProfile, key: PendingKey, instrument?: string): PendingItem | undefined {
  const item = profile.pending.find((p) => p.key === key);
  if (!item) return undefined;
  if (instrument !== undefined && item.instruments && !item.instruments.includes(instrument)) return undefined;
  return item;
}

/** 이 곳(scope)에 걸린 실측 전 항목 */
export function pendingIn(profile: GameProfile, scope: PendingScope): PendingItem[] {
  return profile.pending.filter((p) => p.scope === scope);
}

/** v를 한 번에 낮출 수 있는 최대 단계 (v 범위 전체). 실험실·트릴 창의 단계 입력 상한 */
export function volumeStepMax(profile: GameProfile): number {
  return profile.volume.max - profile.volume.min;
}

/**
 * 붙임 사슬(첫 음부터 &로 이은 음들)의 소리가 샘플 끝에 닿아 끊기는 시각(초).
 * 게임은 붙인 음의 샘플 구간으로 바꿔 타되 샘플 안 재생 위치를 이어 간다(실측). 높이 p에서 Δt 동안
 * 위치는 Δt × 2^((p − 구간 시작)/12)만큼 나아가고, 위치가 지금 구간 길이에 닿으면 끝난다.
 * steps는 각 음의 시작 시각(초)과 접은 뒤 높이. 샘플 길이를 모르면 Infinity.
 * 재생 일정과 악보 진단이 같은 값을 쓰도록 여기 한 곳에서 계산한다.
 */
export function chainSampleEnd(
  profile: GameProfile,
  instrument: string | undefined,
  steps: readonly { readonly at: number; readonly pitch: number }[],
): number {
  return chainPositionEnd(steps, (pitch) => sampleZoneAt(profile, instrument, pitch));
}

/**
 * 붙임 사슬의 소리가 가장 클 때보다 drop dB 작아지는 시각(초). 샘플 안 위치가 그 구간의 drop dB 시각에 닿을 때다
 * (chainSampleEnd와 같은 식). 샘플 끝이 먼저면 샘플 끝. 감쇠를 모르는 악기는 샘플 끝(그것도 모르면 Infinity)
 */
export function chainFadeEnd(
  profile: GameProfile,
  instrument: string | undefined,
  steps: readonly { readonly at: number; readonly pitch: number }[],
  drop: number,
): number {
  const fade = chainPositionEnd(steps, (pitch) => {
    const zone = decayZoneAt(profile, instrument, pitch);
    const seconds = zone && decaySeconds(zone, drop);
    return zone && seconds !== undefined ? { from: zone.from, seconds } : undefined;
  });
  return Math.min(fade, chainSampleEnd(profile, instrument, steps));
}

/** 샘플 안 위치가 구간 길이(zoneAt이 주는 seconds)에 닿는 시각. 구간을 모르는 높이에서는 끝나지 않는다 */
function chainPositionEnd(
  steps: readonly { readonly at: number; readonly pitch: number }[],
  zoneAt: (pitch: number) => SampleZone | undefined,
): number {
  const first = steps[0];
  if (!first) return Infinity;
  const rate = (pitch: number, zone: SampleZone) => 2 ** ((pitch - zone.from) / 12);
  let pos = 0;
  let at = first.at;
  let pitch = first.pitch;
  const endFrom = () => {
    const zone = zoneAt(pitch);
    return zone ? at + Math.max(0, zone.seconds - pos) / rate(pitch, zone) : Infinity;
  };
  for (const step of steps.slice(1)) {
    const end = endFrom();
    if (step.at >= end) return end;
    const zone = zoneAt(pitch);
    if (zone) pos += (step.at - at) * rate(pitch, zone);
    at = step.at;
    pitch = step.pitch;
  }
  return endFrom();
}

/** 이 높이(접힌 뒤)의 감쇠 구간. 모르면 undefined */
export function decayZoneAt(profile: GameProfile, instrument: string | undefined, pitch: number): DecayZone | undefined {
  const zones = instrument !== undefined ? profile.sampleDecay[instrument] : undefined;
  if (!zones || zones.length === 0) return undefined;
  let zone = zones[0]!;
  for (const z of zones) if (z.from <= pitch) zone = z;
  return zone;
}

/** 구간 첫 음 기준 감쇠 점 (시각, dB). 가장 클 때가 0dB이고, 모르는 깊이부터는 점이 없다 */
function decayPoints(zone: DecayZone): [number, number][] {
  const points: [number, number][] = [[0, Math.min(0, zone.startDb)], [zone.peakAt, 0]];
  for (const [db, at] of [[6, zone.db6], [12, zone.db12], [20, zone.db20], [40, zone.db40]] as const) {
    if (at === null) break;
    points.push([at, -db]);
  }
  return points;
}

/**
 * 구간 첫 음이 가장 클 때 뒤로 drop dB 작아지는 시각(초). 점 사이는 dB를 곧게 잇는다.
 * 잰 깊이보다 깊으면 마지막 두 점의 기울기로 이어 가고, 가장 클 때 뒤 점이 하나뿐이라 기울기를 모르면 undefined
 */
function decaySeconds(zone: DecayZone, drop: number): number | undefined {
  const points = decayPoints(zone).slice(1);
  for (let i = 1; i < points.length; i++) {
    const [t0, d0] = points[i - 1]!;
    const [t1, d1] = points[i]!;
    if (-drop >= d1) return t1 === t0 ? t1 : t0 + ((d0 + drop) / (d0 - d1)) * (t1 - t0);
  }
  if (drop <= 0) return zone.peakAt;
  // 잰 마지막 점보다 깊으면 decayDbAt처럼 마지막 두 점의 기울기로 이어 간다 (지속음처럼 가장 클 때 뒤 점이 하나뿐이면 모른다)
  if (points.length < 3) return undefined;
  const [t0, d0] = points[points.length - 2]!;
  const [t1, d1] = points[points.length - 1]!;
  return t1 === t0 || d1 >= d0 ? undefined : t1 + ((-drop - d1) / (d1 - d0)) * (t1 - t0);
}

/**
 * 한 번 친 음이 seconds초 뒤 가장 클 때보다 몇 dB 작은지 (0 이하). 점 사이는 dB를 곧게 잇고, 잰 마지막 점 뒤로는
 * 마지막 두 점의 기울기로 이어 간다. 샘플이 끝난 뒤는 -Infinity. 감쇠를 모르면 0 (줄지 않는다고 본다)
 */
export function decayDbAt(profile: GameProfile, instrument: string | undefined, pitch: number, seconds: number): number {
  const length = sampleSecondsAt(profile, instrument, pitch);
  if (length !== undefined && seconds >= length) return -Infinity;
  const zone = decayZoneAt(profile, instrument, pitch);
  if (!zone || seconds <= 0) return 0;
  // 구간 첫 음보다 높으면 샘플을 빨리 돌리므로 그만큼 앞의 시각을 본다
  const t = seconds * 2 ** ((pitch - zone.from) / 12);
  const points = decayPoints(zone);
  for (let i = 1; i < points.length; i++) {
    const [t0, d0] = points[i - 1]!;
    const [t1, d1] = points[i]!;
    if (t <= t1) return t1 === t0 ? d1 : d0 + ((t - t0) / (t1 - t0)) * (d1 - d0);
  }
  // 잰 마지막 점 뒤: 가장 클 때 뒤의 점이 하나뿐이면(지속음) 그대로, 아니면 마지막 기울기로 이어 간다
  if (points.length < 4) return points.at(-1)![1];
  const [t0, d0] = points[points.length - 2]!;
  const [t1, d1] = points[points.length - 1]!;
  // 두 점이 같은 시각이면(샘플 끝 바로 앞에서 뚝 끊김) 기울기를 모르므로 샘플 끝까지 마지막 값
  return t1 === t0 ? d1 : d1 + ((t - t1) / (t1 - t0)) * (d1 - d0);
}

/**
 * 한 번 친 음이 seconds초 울리는 동안의 평균 크기(dB, 가장 클 때 기준, 에너지 평균). 20ms마다 decayDbAt을 더한다.
 * 샘플이 끝난 뒤는 소리 없음으로 센다. 감쇠를 모르면 0
 */
export function heldMeanDb(profile: GameProfile, instrument: string | undefined, pitch: number, seconds: number): number {
  if (seconds <= 0) return decayDbAt(profile, instrument, pitch, 0);
  const steps = Math.max(1, Math.ceil(seconds / 0.02));
  let power = 0;
  for (let i = 0; i < steps; i++) power += 10 ** (decayDbAt(profile, instrument, pitch, ((i + 0.5) * seconds) / steps) / 10);
  return 10 * Math.log10(power / steps);
}

/** 이 악기로 악보 하나에 담는 트랙 수 */
export function maxChordsOf(profile: GameProfile, instrument: string | undefined): number {
  return (instrument !== undefined ? profile.instrumentMaxChords[instrument] : undefined) ?? profile.maxChordsPerPlayer;
}

/** 악보 악기가 장식품 악기(오르골·축음기)라 트랙마다 다른 악기를 줄 수 없는지 */
export function isSoloInstrument(profile: GameProfile, instrument: string | undefined): boolean {
  return instrument !== undefined && profile.soloInstruments.includes(instrument);
}

export function getProfile(id: string): GameProfile {
  const p = PROFILES[id];
  if (!p) throw new Error(`알 수 없는 게임 프로필: ${id}`);
  return p;
}
