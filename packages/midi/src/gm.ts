/**
 * GM 악기 번호 → 마비노기 악기 추천. 게임에 없는 악기가 많아서 가까운 악기를 고르고
 * 대응이 없으면 matched=false로 알린다. 표는 모바일 프로필 기준이다(PC는 나중에 따로).
 */
export interface InstrumentSuggestion {
  readonly canonical: string;
  /** GM 악기와 잘 맞는 마비노기 악기가 있는지 */
  readonly matched: boolean;
  /** 그 밖의 후보 */
  readonly alternatives: readonly string[];
}

const RANGES: readonly [number, number, string, boolean, readonly string[]][] = [
  // [첫 번호, 끝 번호, 추천, 대응 있음, 다른 후보]
  [0, 7, "piano", true, ["harp", "lute"]],
  [8, 10, "music-box", true, ["xylophone", "harp"]],
  [11, 13, "xylophone", true, ["music-box"]],
  [14, 15, "music-box", false, ["xylophone"]],
  [16, 21, "piano", false, ["chalumeau", "flute"]],
  [22, 22, "harmonica", true, ["chalumeau"]],
  [23, 23, "harmonica", false, ["chalumeau"]],
  [24, 24, "folk-guitar", true, ["lute"]],
  [25, 31, "lute", true, ["folk-guitar", "mandolin"]],
  [32, 39, "lute", false, ["piano", "folk-guitar"]],
  [40, 44, "violin", true, ["chalumeau"]],
  [45, 45, "harp", false, ["lute", "violin"]],
  [46, 46, "harp", true, ["lute"]],
  [47, 47, "bass-drum", false, ["piano"]],
  [48, 55, "violin", false, ["flute", "chalumeau"]],
  [56, 63, "chalumeau", false, ["flute", "violin"]],
  [64, 71, "chalumeau", true, ["flute"]],
  [72, 79, "flute", true, ["chalumeau"]],
  [80, 87, "flute", false, ["chalumeau", "violin"]],
  [88, 103, "violin", false, ["piano", "flute"]],
  [104, 104, "lute", false, ["mandolin"]],
  [105, 105, "mandolin", false, ["lute"]],
  [106, 106, "mandolin", false, ["lute"]],
  [107, 108, "harp", false, ["lute"]],
  [109, 111, "chalumeau", false, ["flute"]],
  [112, 112, "music-box", false, ["xylophone"]],
  [113, 119, "bass-drum", false, ["cymbal"]],
  [120, 127, "piano", false, []],
];

export function suggestInstrument(program: number): InstrumentSuggestion {
  const row = RANGES.find(([from, to]) => program >= from && program <= to) ?? RANGES[0]!;
  return { canonical: row[2], matched: row[3], alternatives: row[4] };
}

/**
 * GM 드럼(10번 채널) 음 번호 → 마비노기 타악기. 없는 소리는 빼고 개수만 알린다.
 * 마비노기 타악기는 큰북·심벌즈 두 가지뿐이다.
 */
export function drumInstrument(pitch: number): "bass-drum" | "cymbal" | undefined {
  if (pitch === 35 || pitch === 36 || pitch === 41 || pitch === 43) return "bass-drum";
  if ([49, 51, 52, 53, 55, 57, 59].includes(pitch)) return "cymbal";
  return undefined;
}

/** 마비노기 악기 → GM 악기 번호 (MIDI로 저장할 때). 다시 가져오면 같은 악기로 추천되는 번호를 고른다 */
const GM_PROGRAM: Readonly<Record<string, number>> = {
  piano: 0,
  "music-box": 10,
  xylophone: 13,
  harmonica: 22,
  "cat-harmonica": 22,
  "folk-guitar": 24,
  lute: 25,
  violin: 40,
  harp: 46,
  chalumeau: 71,
  flute: 73,
  mandolin: 105,
};

export function gmProgramOf(canonical: string): number {
  return GM_PROGRAM[canonical] ?? 0;
}

/** 타악기는 GM 드럼 채널(10번)에 이 건반으로 낸다 */
export const GM_DRUM_KEY: Readonly<Record<string, number>> = { "bass-drum": 36, cymbal: 49 };
