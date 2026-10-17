import { instrumentByName, isMabiiccoPack, splitPackProgram } from "@mmlce/core";

/** 사운드팩에서 읽은 악기 하나 */
export interface PackInstrument {
  readonly program: number;
  readonly name: string;
  /** 이름으로 찾은 공통 ID. 모르는 악기면 없음 */
  readonly canonical?: string;
}

export interface SoundPackInfo {
  readonly id: string;
  readonly label: string;
  /** 이 팩에 준 뱅크 번호. 모든 팩이 뱅크 0을 써서 그대로 올리면 겹치므로 팩마다 다르게 준다 */
  readonly bank: number;
  readonly instruments: readonly PackInstrument[];
}

/**
 * 악기별 음량(dB, 0이 그대로). 키는 gainKey(팩 이름, 번호).
 * 팩 이름(파일 이름)으로 기억하므로 같은 팩을 다시 올려도 그대로 남는다
 */
export type InstrumentGains = Readonly<Record<string, number>>;

export const gainKey = (packLabel: string, program: number) => `${packLabel}#${program}`;

/** dB → 곱할 배율 */
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** 실제로 소리 낼 (뱅크, 번호) */
export interface ResolvedPatch {
  readonly packId: string;
  readonly bank: number;
  readonly program: number;
  readonly name: string;
  /** 찾은 프리셋을 이름으로 알아본 공통 ID. `mabi:번호`로 찾았어도 음역·샘플 길이를 이걸로 정한다 */
  readonly canonical?: string;
}

/** 등록부가 읽어야 하는 사운드뱅크 정보. SpessaSynth의 BasicSoundBank가 이 모양을 갖는다 */
export interface PresetSource {
  readonly presets: readonly { readonly program: number; readonly bankMSB: number; readonly name: string }[];
}

const UNUSED = /not\s*used/i;

/**
 * 여러 사운드팩을 동시에 올려 두고, 공통 악기 ID를 (팩, 번호)로 바꿔 준다.
 * 팩 순서가 우선순위다. 앞 팩에 없는 악기는 다음 팩에서 찾는다.
 */
export class SoundPackRegistry {
  private packs: SoundPackInfo[] = [];
  private bankCounter = 0;

  get list(): readonly SoundPackInfo[] {
    return this.packs;
  }

  /** 다음에 올릴 팩이 받을 뱅크 번호. 신스에 먼저 올리고 등록할 때 쓴다 */
  get nextBank(): number {
    return this.bankCounter;
  }

  add(id: string, label: string, source: PresetSource): SoundPackInfo {
    if (this.packs.some((p) => p.id === id)) throw new Error(`이미 올린 사운드팩: ${id}`);
    const instruments = source.presets
      .filter((p) => p.bankMSB === 0 && !UNUSED.test(p.name))
      .map((p) => {
        const canonical = instrumentByName(p.name)?.id;
        return canonical ? { program: p.program, name: p.name, canonical } : { program: p.program, name: p.name };
      })
      .sort((a, b) => a.program - b.program);
    const info: SoundPackInfo = { id, label, bank: this.bankCounter++, instruments };
    this.packs.push(info);
    return info;
  }

  remove(id: string): void {
    this.packs = this.packs.filter((p) => p.id !== id);
  }

  /** 우선순위 바꾸기. 목록에 없는 팩은 뒤로 */
  setOrder(ids: readonly string[]): void {
    const rank = (p: SoundPackInfo) => {
      const i = ids.indexOf(p.id);
      return i < 0 ? ids.length : i;
    };
    this.packs = [...this.packs].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * 공통 ID(예: "folk-guitar")나 `mabi:번호`를 실제 패치로.
   * `preferPack`을 주면 그 팩을 먼저 본다(트랙별로 팩을 고른 경우).
   * 마비꼬 추가 팩 번호(팩 × 512 + 번호, 화면의 "40.3", 파일의 1576)는 `mabi:번호`나 `program`에서 팩 번호를 읽는다.
   * - 그 팩 번호에 맞는 사운드팩(.2·.3)을 올린 순서와 상관없이 먼저 본다.
   * - 번호로만 찾을 때는 그 팩(또는 `preferPack`) 안에서만 찾는다. 팩마다 같은 번호가 다른 악기일 수 있어서
   *   (같은 기타가 한 팩은 30번, 다른 팩은 40번) 다른 팩의 같은 번호로 넘어가면 다른 악기가 울린다. 없으면 찾지 못한 악기
   * - 공통 ID(하프 등)는 같은 악기임이 이름으로 확인되므로 그 팩에 없으면 다른 팩에서도 찾는다
   */
  resolve(instrument: string, program?: number, preferPack?: string): ResolvedPatch | undefined {
    const numbered = /^mabi:(\d+)$/.exec(instrument);
    const raw = numbered ? Number(numbered[1]) : program;
    const split = raw === undefined ? undefined : splitPackProgram(raw);
    const suffix = split?.pack ?? 0;
    const own = (p: SoundPackInfo) => suffix > 0 && isMabiiccoPack(suffix, p.label);
    // 번호로 찾아도 되는 팩: 팩 번호가 없으면 모든 팩, 있으면 그 팩과 사용자가 고른 팩만
    const byNumber = (p: SoundPackInfo) => suffix === 0 || own(p) || p.id === preferPack;
    const first = (want: (p: SoundPackInfo) => boolean, list: readonly SoundPackInfo[]) => [
      ...list.filter(want),
      ...list.filter((p) => !want(p)),
    ];
    let order: readonly SoundPackInfo[] = first(own, this.packs);
    if (preferPack) order = first((p) => p.id === preferPack, order);
    for (const pack of order) {
      const number = split && byNumber(pack) ? split.number : undefined;
      const found = numbered
        ? number === undefined ? undefined : pack.instruments.find((i) => i.program === number)
        : (pack.instruments.find((i) => i.canonical === instrument) ??
          (number === undefined ? undefined : pack.instruments.find((i) => i.program === number && !i.canonical)));
      if (found) {
        const patch = { packId: pack.id, bank: pack.bank, program: found.program, name: found.name };
        return found.canonical ? { ...patch, canonical: found.canonical } : patch;
      }
    }
    return undefined;
  }

  /** 이 팩의 이 악기에 줄 음량 배율 (설정에 없으면 1) */
  gainOf(packId: string, program: number, gains: InstrumentGains): number {
    const pack = this.packs.find((p) => p.id === packId);
    const db = pack ? gains[gainKey(pack.label, program)] : undefined;
    return db ? dbToGain(db) : 1;
  }
}
