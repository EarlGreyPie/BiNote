import { add, cmp, splitPackProgram, toFloat, trackInstrument, type InstrumentRef, type Note, type Song, type Track } from "@mmlce/core";
import { GM_DRUM_KEY, gmProgramOf } from "./gm.js";
import type { Smf, SmfEvent } from "./smf.js";

export interface SmfExportOptions {
  /**
   * 트랙 악기의 실제 공통 ID를 알려 준다(보통 사운드팩 등록부, 재생과 같은 해석). `mabi:1578`(#42.3)처럼 번호로만 아는
   * 악기도 올린 팩의 프리셋이 냥모니카면 GM 번호를 냥모니카로 고른다. pack은 트랙에서 고른 팩 파일 이름(InstrumentRef.packId)으로,
   * 재생처럼 그 팩을 먼저 본다. 모르면 undefined(원래 ID로 고른다)
   */
  readonly canonicalOf?: (instrument: string, program: number | undefined, pack?: string) => string | undefined;
}

/**
 * 곡을 MIDI로 (내보내기). 연주자마다 MIDI 트랙 하나, 볼륨 v는 세기로 바꾼다(v×127/15, DLS 기본 곡선과 같음).
 * 같은 음 &는 한 음으로 합친다(다른 음 &의 슬라이드는 MIDI에 없어 따로 친 음이 된다).
 * 위치는 ppq 격자에 반올림한다(MIDI는 정수 tick이라 l7 같은 길이는 근사가 된다).
 *
 * 악기 번호는 programs로 고른다.
 * - gm(기본): 다른 프로그램에서 열 수 있게 GM 번호로 바꾸고 타악기는 10번 채널 드럼으로 낸다
 * - mabinogi: 마비노기 악기 번호 그대로 (마비노기 번호로 만든 사운드팩용)
 * 같은 악기 연주자는 채널을 함께 써서 연주자가 16명을 넘어도 다른 악기와 섞이지 않는다.
 * 다만 같은 높이 음이 겹치면 어느 음을 끄는지 구별할 수 없으므로 그 연주자는 다른 채널로 보낸다.
 * 음 높이는 악보에 적힌 그대로 쓴다(게임처럼 음역 밖 음을 접지 않는다).
 */
export function songToSmf(
  song: Song,
  ppq = 480,
  volumeMax = 15,
  programs: "gm" | "mabinogi" = "gm",
  options: SmfExportOptions = {},
): Smf {
  const tick = (at: { n: number; d: number }) => Math.round(toFloat(at) * ppq * 4);
  const conductor: SmfEvent[] = song.tempo.map((t) => ({ tick: tick(t.at), type: "tempo", usPerQuarter: Math.round(60_000_000 / t.bpm) }));
  // 곡 중간 박자 변화도 함께 쓴다
  for (const sig of song.timeSig) conductor.push({ tick: tick(sig.at), type: "timeSig", beats: sig.beats, unit: sig.unit });
  const tracks = [{ events: conductor }];
  type Span = [number, number, number];
  // 연주자마다 악기와 낼 음. 같은 음 &는 볼륨이 달라도 첫 음 볼륨으로 이어지는 한 음이다 (게임·앱 재생과 같음)
  // 트랙마다 악기를 따로 정할 수 있어서, 악보 안에서도 악기가 다르면 MIDI 트랙을 나눈다
  const units = song.players.flatMap((player) => {
    const byInstrument = new Map<string, { player: typeof player; instrument: InstrumentRef; tracks: Track[] }>();
    for (const track of song.tracks.filter((t) => t.playerId === player.id)) {
      const instrument = trackInstrument(song, track);
      // 같은 번호라도 트랙마다 고른 팩이 다르면 다른 악기로 들리므로 따로 낸다
      const key = `${instrument.canonical}#${instrument.program ?? ""}@${instrument.packId ?? ""}`;
      const unit = byInstrument.get(key) ?? { player, instrument, tracks: [] };
      unit.tracks.push(track);
      byInstrument.set(key, unit);
    }
    return [...byInstrument.values()];
  });
  const plans = units.map(({ player, instrument, tracks: own }, _i, all) => {
    // GM 번호·드럼 여부·이름은 실제로 울리는 악기로 정한다. 마비노기 번호는 원래 번호 그대로
    const canonical = options.canonicalOf?.(instrument.canonical, instrument.program, instrument.packId) ?? instrument.canonical;
    const drumKey = programs === "gm" ? GM_DRUM_KEY[canonical] : undefined;
    // 마비노기 번호는 마비꼬 추가 팩 번호(팩 × 512 + 번호)면 팩 안 번호만 쓴다. MIDI 악기 번호는 0~127
    const program = programs === "gm" ? gmProgramOf(canonical) : splitPackProgram(instrument.program ?? 0).number & 0x7f;
    const several = all.filter((u) => u.player === player).length > 1;
    const notes = own
      .flatMap((t) => soundNotes(t.notes))
      .map((n) => ({ pitch: drumKey ?? n.pitch, on: tick(n.start), off: tick(add(n.start, n.dur)), vol: n.vol }));
    const spans: Span[] = notes.map((n) => [n.pitch, n.on, n.off]);
    return { player, name: several ? `${player.name} (${canonical})` : player.name, drumKey, program, key: `${program}`, notes, spans };
  });

  // 채널: 악기마다 먼저 하나씩 잡고, 남는 채널로 같은 악기 안의 같은 높이 겹침을 나눈다
  // (같은 채널에서 같은 높이가 겹치면 어느 음을 끄는지 MIDI로 구별할 수 없음)
  const channels: { key: string; spans: Span[] }[] = [];
  for (const plan of plans) {
    if (plan.drumKey === undefined && !channels.some((c) => c.key === plan.key) && channels.length < CHANNELS_WITHOUT_DRUMS.length) {
      channels.push({ key: plan.key, spans: [] });
    }
  }
  const clash = (a: readonly Span[], b: readonly Span[]) => a.some(([p, s, e]) => b.some(([q, t, f]) => p === q && s < f && t < e));
  for (const plan of plans) {
    let channel = 9;
    if (plan.drumKey === undefined) {
      let k = channels.findIndex((c) => c.key === plan.key && !clash(c.spans, plan.spans));
      if (k < 0 && channels.length < CHANNELS_WITHOUT_DRUMS.length) {
        channels.push({ key: plan.key, spans: [] });
        k = channels.length - 1;
      }
      // 채널이 모자라면 같은 악기 채널을 함께 쓴다 (악기 종류가 채널보다 많으면 마지막 채널)
      if (k < 0) {
        const same = channels.findIndex((c) => c.key === plan.key);
        k = same >= 0 ? same : channels.length - 1;
      }
      channels[k]!.spans.push(...plan.spans);
      channel = CHANNELS_WITHOUT_DRUMS[k]!;
    }
    const events: SmfEvent[] = [{ tick: 0, type: "name", text: plan.name }];
    if (plan.drumKey === undefined) events.push({ tick: 0, type: "program", channel, program: plan.program });
    for (const n of plan.notes) {
      events.push({ tick: n.on, type: "noteOn", channel, pitch: n.pitch, velocity: Math.max(1, Math.round((n.vol * 127) / volumeMax)) });
      events.push({ tick: n.off, type: "noteOff", channel, pitch: n.pitch });
    }
    tracks.push({ events });
  }
  return { format: 1, ppq, tracks };
}

/** 같은 높이로 &로 바로 이은 음을 하나로 합친다. 볼륨은 첫 음 것을 쓰고, 첫 음이 v0이면 사슬 전체가 무음이다 */
function soundNotes(notes: readonly Note[]): Note[] {
  const out: Note[] = [];
  let joining = false;
  for (const n of [...notes].sort((a, b) => cmp(a.start, b.start))) {
    const prev = out[out.length - 1];
    if (joining && prev && prev.pitch === n.pitch && cmp(add(prev.start, prev.dur), n.start) === 0) {
      out[out.length - 1] = { ...prev, dur: add(prev.dur, n.dur), tie: n.tie };
    } else out.push(n);
    joining = n.tie === "next";
  }
  return out.filter((n) => n.vol > 0);
}

const CHANNELS_WITHOUT_DRUMS = Array.from({ length: 16 }, (_, i) => i).filter((c) => c !== 9);
