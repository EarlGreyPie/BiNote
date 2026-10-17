/**
 * 마비노기 악기 공통 ID. 곡 파일과 모델은 이 ID만 저장하고,
 * 사운드팩의 실제 (팩, 번호)는 재생할 때 사운드팩 등록부가 이름으로 찾는다.
 */
export interface InstrumentInfo {
  readonly id: string;
  /** PC 마비노기와 같은 번호로 알려진 경우. 모바일 전용 악기는 팩마다 달라 비워 둔다 */
  readonly program?: number;
  /** 사운드팩 프리셋 이름과 맞춰 볼 별칭 (소문자, 영문·숫자만) */
  readonly aliases: readonly string[];
  readonly percussion?: boolean;
}

export const INSTRUMENTS: readonly InstrumentInfo[] = [
  { id: "lute", program: 0, aliases: ["lute"] },
  { id: "mandolin", program: 2, aliases: ["mandolin"] },
  { id: "flute", program: 5, aliases: ["flute"] },
  { id: "chalumeau", program: 6, aliases: ["chalumeau"] },
  { id: "piano", program: 21, aliases: ["piano"] },
  { id: "violin", program: 22, aliases: ["violin"] },
  { id: "harp", program: 24, aliases: ["harp"] },
  { id: "music-box", program: 29, aliases: ["musicbox"] },
  // 모바일 전용: 팩마다 번호가 다르다(30/40 등). 인게임 번호는 실측 대기
  { id: "folk-guitar", aliases: ["folkguitar", "guitar"] },
  { id: "harmonica", aliases: ["harmonica"] },
  { id: "cat-harmonica", aliases: ["nyanmonica", "catharmonica"] },
  // 하우징 가구 축음기. BINOTE DLS Pack v0.2에서는 43번
  { id: "gramophone", aliases: ["gramophone"] },
  { id: "bass-drum", program: 66, aliases: ["bassdrum"], percussion: true },
  { id: "cymbal", program: 68, aliases: ["cymbal"], percussion: true },
  { id: "xylophone", program: 77, aliases: ["xylophone"] },
];

export function normalizeInstrumentName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 프리셋 이름으로 공통 ID를 찾는다. 모르면 undefined */
export function instrumentByName(name: string): InstrumentInfo | undefined {
  const key = normalizeInstrumentName(name);
  return INSTRUMENTS.find((i) => i.aliases.includes(key));
}

/**
 * 마비꼬는 추가 사운드팩의 악기를 화면에 "번호.팩"(예: 24.2)으로 보이고, 파일에는 팩 × 512 + 번호로 적는다.
 * 팩 0은 PC 마비노기 기본 음원이다. 실제 파일(1048 = 하프 24.2, 1090 = 북 66.2 등)로 확인한 규칙
 */
export const MABIICCO_PACK_STRIDE = 512;

export function splitPackProgram(program: number): { pack: number; number: number } {
  return { pack: Math.floor(program / MABIICCO_PACK_STRIDE), number: program % MABIICCO_PACK_STRIDE };
}

/**
 * 마비꼬 팩 번호가 가리키는 사운드팩을 파일 이름으로 알아본다. .2 = Furika, .3 = Harmonic Muse.
 * 이름이 비슷한 "Fury Harmonic muse Pack"은 마비꼬에서 .3이 아니므로 뺀다.
 * 모르는 팩 번호면 false
 */
export function isMabiiccoPack(pack: number, label: string): boolean {
  if (pack === 2) return /furika/i.test(label);
  if (pack === 3) return /harmonic\s*muse/i.test(label) && !/fury/i.test(label);
  return false;
}

/**
 * 파일에 적힌 악기 번호로 공통 ID를 찾는다. 번호가 겹치지 않는 악기만.
 * 마비꼬 추가 팩 번호(팩 × 512 + 번호)도 팩 안 번호가 PC 마비노기와 같아서 같은 표로 찾는다
 */
export function instrumentByProgram(program: number): InstrumentInfo | undefined {
  const { number } = splitPackProgram(program);
  return INSTRUMENTS.find((i) => i.program === number);
}
