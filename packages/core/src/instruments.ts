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

/** 파일에 적힌 악기 번호로 공통 ID를 찾는다. 번호가 겹치지 않는 악기만 */
export function instrumentByProgram(program: number): InstrumentInfo | undefined {
  return INSTRUMENTS.find((i) => i.program === program);
}
