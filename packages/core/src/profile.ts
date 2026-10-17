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
   * 화음감쇠: 같은 v로 n음을 함께 치면 단음보다 perDoublingDb × log2(n) dB 커진다 (3dB면 음 에너지의 단순 합).
   * 화음의 v는 볼륨 곡선에서 그만큼 낮춘 값으로 고른다
   */
  readonly chordAttenuation: { readonly perDoublingDb: number };
  /** 게임에 붙여넣는 형식. "mml-at" = 악보 하나를 MML@트랙1,트랙2,...; 로 (PC와 같음, 2026-10-14 확인) */
  readonly clipboardFormat: "mml-at";
  /** 아직 인게임 실측으로 확인하지 못한 항목. 값은 임시 기본값이다 */
  readonly pending: readonly PendingKey[];
}

export interface SampleZone {
  readonly from: number;
  readonly seconds: number;
}

export interface PitchRange {
  readonly low: number;
  readonly high: number;
}

export type PendingKey =
  | "volumeCurve"
  | "soundingRangeInstruments"
  | "playerChannelSeparation";

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
 *   1화음 악기(그냥 "피아노")는 첫 트랙만 소리 나고, 3화음 악기는 4트랙 악보에서도 ChannelCount 3 (4번째 트랙이 나는지는 미확인).
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
 * - 음색 경계 위 e를 붙이면 한 번만 치고 이어진다 (튐 없음).
 * - 축음기(하우징 가구, 2026-10-16 직접 재생해 녹음): 오르골처럼 악보 하나에 3트랙. o1e~o7e(28~100), 범위 밖은 옥타브째 접힌다.
 *   줄지 않는 지속음인데 샘플이 끝나면 끊긴다(4.5~5.3초). 구간 경계 51|52·88|89는 반음씩 친 녹음의 음색 변화로,
 *   64|66·78|80은 6초 녹음 길이로 확인했다. 65·79는 녹음에 없어 위 구간에 넣었다(미확인). 식과 실측 차이 0.01초 이내.
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
  sampleSeconds: {
    piano: [{ from: 40, seconds: 5.31 }, { from: 52, seconds: 5.3 }, { from: 64, seconds: 5.29 }, { from: 77, seconds: 5.04 }, { from: 89, seconds: 4.99 }],
    lute: [{ from: 38, seconds: 5.8 }, { from: 52, seconds: 4.8 }, { from: 64, seconds: 5.24 }, { from: 77, seconds: 4.86 }],
    mandolin: [{ from: 38, seconds: 5.67 }, { from: 52, seconds: 5.13 }, { from: 64, seconds: 4.98 }, { from: 77, seconds: 4.94 }],
    harp: [{ from: 40, seconds: 5.26 }, { from: 52, seconds: 5.23 }, { from: 64, seconds: 5.02 }, { from: 77, seconds: 4.33 }, { from: 89, seconds: 4.4 }],
    "folk-guitar": [{ from: 40, seconds: 5.26 }, { from: 52, seconds: 5.26 }, { from: 64, seconds: 5.27 }, { from: 77, seconds: 4.44 }, { from: 89, seconds: 4.67 }],
    xylophone: [{ from: 28, seconds: 5.26 }, { from: 52, seconds: 2.66 }, { from: 66, seconds: 2.26 }, { from: 80, seconds: 2.08 }],
    flute: [{ from: 52, seconds: 5.35 }, { from: 76, seconds: 5.39 }, { from: 88, seconds: 5.37 }],
    violin: [{ from: 50, seconds: 5.49 }, { from: 60, seconds: 4.58 }, { from: 66, seconds: 4.9 }, { from: 74, seconds: 4.45 }],
    chalumeau: [{ from: 30, seconds: 5.67 }, { from: 42, seconds: 5.67 }, { from: 56, seconds: 5.1 }, { from: 70, seconds: 4.57 }, { from: 82, seconds: 4.56 }],
    harmonica: [{ from: 40, seconds: 5.25 }, { from: 52, seconds: 5.28 }, { from: 64, seconds: 5.27 }, { from: 77, seconds: 4.97 }, { from: 89, seconds: 4.99 }],
    "music-box": [{ from: 28, seconds: 5.05 }, { from: 52, seconds: 2.24 }, { from: 66, seconds: 2.05 }, { from: 80, seconds: 1.79 }, { from: 90, seconds: 1.97 }],
    gramophone: [{ from: 40, seconds: 5.33 }, { from: 52, seconds: 5.33 }, { from: 65, seconds: 5.02 }, { from: 79, seconds: 4.47 }, { from: 89, seconds: 5.02 }],
    "cat-harmonica": [{ from: 28, seconds: 0.47 }, { from: 32, seconds: 0.74 }, { from: 44, seconds: 0.73 }, { from: 56, seconds: 0.72 }, { from: 68, seconds: 0.74 }, { from: 80, seconds: 0.47 }, { from: 84, seconds: 0.49 }],
  },
  chordAttenuation: { perDoublingDb: 3 },
  clipboardFormat: "mml-at",
  pending: ["playerChannelSeparation"],
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

/** 다른 음 붙임을 다시 치지 않고 높이만 옮기는 최대 거리(반음). 더 멀면 새로 친다 (재생의 벤드 범위) */
export const TIE_BEND_LIMIT = 24;

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
  const first = steps[0];
  if (!first) return Infinity;
  const rate = (pitch: number, zone: SampleZone) => 2 ** ((pitch - zone.from) / 12);
  let pos = 0;
  let at = first.at;
  let pitch = first.pitch;
  const endFrom = () => {
    const zone = sampleZoneAt(profile, instrument, pitch);
    return zone ? at + Math.max(0, zone.seconds - pos) / rate(pitch, zone) : Infinity;
  };
  for (const step of steps.slice(1)) {
    const end = endFrom();
    if (step.at >= end) return end;
    const zone = sampleZoneAt(profile, instrument, pitch);
    if (zone) pos += (step.at - at) * rate(pitch, zone);
    at = step.at;
    pitch = step.pitch;
  }
  return endFrom();
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
