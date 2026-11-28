import { add, cmp, pickupOf, splitPackProgram, structureMarkers, toFloat, trackInstrument, type InstrumentRef, type Note, type Song, type Track } from "@mmlce/core";
import { GM_DRUM_KEY, gmProgramOf } from "./gm.js";
import { PICKUP_MARKER } from "./analyze.js";
import type { Smf, SmfEvent } from "./smf.js";

/** MIDI 내보내기에서 그대로 옮기지 못한 것. 화면은 `diag.<code>` 문구로 보인다 */
export interface SmfExportNotice {
  readonly level: "warning";
  /** midi-pitch-folded: 0-127 밖이라 옥타브로 접은 음 / midi-overlap-shared: 채널이 모자라 같은 높이 겹침을 나누지 못한 음 */
  readonly code: "midi-pitch-folded" | "midi-overlap-shared";
  readonly params: { readonly count: number };
  readonly span: readonly [number, number];
  /** MIDI 트랙 이름(연주자 이름) */
  readonly where: string;
}

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
 * 다만 같은 채널에서 같은 높이 음이 겹치면 어느 음을 끄는지 구별할 수 없으므로,
 * 한 연주자(같은 악기) 안에서 겹치는 음은 다음 "목소리"(따로 MIDI 트랙)로 나누고, 겹치는 연주자·목소리는 다른 채널로 보낸다.
 * 채널이 모자라 함께 쓰게 된 겹침 음은 알림으로 센다. 시작과 끝, 높이가 모두 같은 음은 한 음으로 친다.
 * 음 높이는 악보에 적힌 그대로 쓰되, MIDI가 담을 수 없는 0-127 밖의 음만 옥타브로 접어 넣고 알림으로 센다.
 */
export function songToSmf(
  song: Song,
  ppq = 480,
  volumeMax = 15,
  programs: "gm" | "mabinogi" = "gm",
  options: SmfExportOptions = {},
): Smf {
  return songToSmfReport(song, ppq, volumeMax, programs, options).smf;
}

/** songToSmf와 같고, 그대로 옮기지 못한 것의 알림을 함께 돌려준다 */
export function songToSmfReport(
  song: Song,
  ppq = 480,
  volumeMax = 15,
  programs: "gm" | "mabinogi" = "gm",
  options: SmfExportOptions = {},
): { smf: Smf; notices: SmfExportNotice[] } {
  const notices: SmfExportNotice[] = [];
  const tick = (at: { n: number; d: number }) => Math.round(toFloat(at) * ppq * 4);
  const conductor: SmfEvent[] = song.tempo.map((t) => ({ tick: tick(t.at), type: "tempo", usPerQuarter: Math.round(60_000_000 / t.bpm) }));
  // 곡 중간 박자 변화도 함께 쓴다
  for (const sig of song.timeSig) conductor.push({ tick: tick(sig.at), type: "timeSig", beats: sig.beats, unit: sig.unit });
  // 마커도 쓴다 (다시 가져오면 곡 마커로 돌아온다). 작업 메모는 프로젝트 파일에만 둔다
  // 이름이 못갖춘마디 약속 글자와 같은 마커는 쓰지 않는다 (다시 가져올 때 못갖춘마디로 잘못 읽히지 않게)
  for (const m of structureMarkers(song.markers)) if (m.label.trim() !== PICKUP_MARKER) conductor.push({ tick: tick(m.at), type: "marker", text: m.label });
  // 못갖춘마디는 Basic Scriptor와 같은 약속(0에 BS:pickup 마커)으로 적는다. 다시 가져오면 못갖춘마디로 돌아온다
  if (pickupOf(song.timeSig)) conductor.push({ tick: 0, type: "marker", text: PICKUP_MARKER });
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
  const plans = units.flatMap(({ player, instrument, tracks: own }, _i, all) => {
    // GM 번호·드럼 여부·이름은 실제로 울리는 악기로 정한다. 마비노기 번호는 원래 번호 그대로
    const canonical = options.canonicalOf?.(instrument.canonical, instrument.program, instrument.packId) ?? instrument.canonical;
    const drumKey = programs === "gm" ? GM_DRUM_KEY[canonical] : undefined;
    // 마비노기 번호는 마비꼬 추가 팩 번호(팩 × 512 + 번호)면 팩 안 번호만 쓴다. MIDI 악기 번호는 0~127
    const program = programs === "gm" ? gmProgramOf(canonical) : splitPackProgram(instrument.program ?? 0).number & 0x7f;
    const several = all.filter((u) => u.player === player).length > 1;
    const name = several ? `${player.name} (${canonical})` : player.name;
    let folded = 0;
    const notes = own
      .flatMap((t) => soundNotes(t.notes))
      .map((n) => {
        const pitch = drumKey ?? foldPitch(n.pitch);
        if (pitch !== n.pitch && drumKey === undefined) folded++;
        return { pitch, on: tick(n.start), off: tick(add(n.start, n.dur)), vol: n.vol };
      });
    if (folded > 0) notices.push({ level: "warning", code: "midi-pitch-folded", params: { count: folded }, span: [0, 0], where: name });
    // 드럼은 모두 10번 채널이라 나눠도 소용이 없으므로 한 트랙 그대로 둔다
    const voices = drumKey === undefined ? splitVoices(notes) : [notes];
    return voices.map((voice, v) => ({
      player,
      name: v === 0 ? name : `${name} ${v + 1}`,
      drumKey,
      program,
      key: `${program}`,
      notes: voice,
      spans: voice.map((n): Span => [n.pitch, n.on, n.off]),
    }));
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
        // 함께 쓰는 채널에서 같은 높이로 겹치는 음은 길이가 어긋날 수 있다
        const shared = channels[k]!.spans;
        const count = plan.spans.filter((sp) => clash(shared, [sp])).length;
        if (count > 0) notices.push({ level: "warning", code: "midi-overlap-shared", params: { count }, span: [0, 0], where: plan.name });
      }
      for (const sp of plan.spans) channels[k]!.spans.push(sp);
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
  return { smf: { format: 1, ppq, tracks }, notices };
}

/** MIDI 음 번호(0-127) 밖이면 옥타브 단위로 접어 넣는다 (게임도 음역 밖 음을 옥타브로 접는다). 7비트로 잘려 다른 음이 되지 않게 */
export function foldPitch(pitch: number): number {
  let p = Math.round(pitch);
  while (p > 127) p -= 12;
  while (p < 0) p += 12;
  return p;
}

/**
 * 한 MIDI 트랙 안에서 같은 높이 음이 겹치지 않게 목소리로 나눈다. 시작 순으로 훑어 겹치지 않는 첫 목소리에 넣는다.
 * 높이·시작·끝이 모두 같은 음은 겹침이 아니라 중복이라 한 음으로 친다(더 센 쪽을 남긴다)
 */
export function splitVoices<N extends { pitch: number; on: number; off: number; vol: number }>(notes: readonly N[]): N[][] {
  const voices: { notes: N[]; end: Map<number, number> }[] = [];
  const seen = new Map<string, { voice: N[]; index: number }>();
  const sorted = [...notes].sort((a, b) => a.on - b.on || a.pitch - b.pitch || a.off - b.off);
  for (const n of sorted) {
    const key = `${n.pitch}:${n.on}:${n.off}`;
    const dup = seen.get(key);
    if (dup) {
      if (n.vol > dup.voice[dup.index]!.vol) dup.voice[dup.index] = n;
      continue;
    }
    // 시작 순이라 목소리마다 높이별 가장 늦은 끝만 보면 된다
    let voice = voices.find((v) => (v.end.get(n.pitch) ?? -Infinity) <= n.on);
    if (!voice) {
      voice = { notes: [], end: new Map() };
      voices.push(voice);
    }
    voice.notes.push(n);
    voice.end.set(n.pitch, Math.max(voice.end.get(n.pitch) ?? -Infinity, n.off));
    seen.set(key, { voice: voice.notes, index: voice.notes.length - 1 });
  }
  return voices.length > 0 ? voices.map((v) => v.notes) : [[]];
}

/**
 * 소리 나는 음: 같은 높이로 &로 바로 이은 음을 하나로 합친다. 볼륨은 사슬 첫 음 것이고 (게임은 & 뒤의 v를 무시한다),
 * 다른 높이로 이은 음(슬라이드)도 첫 음 볼륨으로 이어진다. 첫 음이 v0이면 사슬 전체가 무음이라 뺀다
 */
export function soundNotes(notes: readonly Note[]): Note[] {
  const out: Note[] = [];
  let joining = false;
  let headVol = 0;
  for (const n of [...notes].sort((a, b) => cmp(a.start, b.start))) {
    const prev = out[out.length - 1];
    const joined = joining && !!prev && cmp(add(prev.start, prev.dur), n.start) === 0;
    if (joined && prev.pitch === n.pitch) {
      out[out.length - 1] = { ...prev, dur: add(prev.dur, n.dur), tie: n.tie };
    } else if (joined) {
      out.push({ ...n, vol: headVol });
    } else {
      headVol = n.vol;
      out.push(n);
    }
    joining = n.tie === "next";
  }
  return out.filter((n) => n.vol > 0);
}

const CHANNELS_WITHOUT_DRUMS = Array.from({ length: 16 }, (_, i) => i).filter((c) => c !== 9);
