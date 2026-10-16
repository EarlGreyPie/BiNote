/**
 * 표준 MIDI 파일(SMF) 읽기·쓰기. 가져오기에 필요한 이벤트만 다룬다:
 * 음 켜기·끄기, 프로그램 변경, 컨트롤(서스테인 등), 템포, 박자, 트랙 이름.
 * 시간은 파일의 tick 그대로 둔다(분수 변환은 가져오기 단계에서).
 */
export type SmfEvent =
  | { readonly tick: number; readonly type: "noteOn"; readonly channel: number; readonly pitch: number; readonly velocity: number }
  | { readonly tick: number; readonly type: "noteOff"; readonly channel: number; readonly pitch: number }
  | { readonly tick: number; readonly type: "program"; readonly channel: number; readonly program: number }
  | { readonly tick: number; readonly type: "control"; readonly channel: number; readonly control: number; readonly value: number }
  /** 4분음표 하나의 마이크로초 */
  | { readonly tick: number; readonly type: "tempo"; readonly usPerQuarter: number }
  | { readonly tick: number; readonly type: "timeSig"; readonly beats: number; readonly unit: number }
  | { readonly tick: number; readonly type: "name"; readonly text: string };

export interface SmfTrack {
  readonly events: SmfEvent[];
  /** End-of-Track 이벤트의 tick. 끝 음 없이 길게 이어지는 페달 음을 여기서 닫는다 */
  readonly endTick?: number;
}

export interface Smf {
  readonly format: number;
  /** 4분음표 하나의 tick 수 */
  readonly ppq: number;
  readonly tracks: SmfTrack[];
}

export class SmfError extends Error {}

export function readSmf(bytes: Uint8Array): Smf {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const tag = () => String.fromCharCode(...bytes.subarray(pos, pos + 4));
  if (bytes.length < 14 || tag() !== "MThd") throw new SmfError("MIDI 파일이 아닙니다");
  const headerLength = view.getUint32(4);
  const format = view.getUint16(8);
  const count = view.getUint16(10);
  const division = view.getUint16(12);
  // SMPTE 시간 단위(최상위 비트)는 드물어서 받지 않는다
  if (division & 0x8000) throw new SmfError("SMPTE 시간 단위 MIDI는 읽을 수 없습니다");
  pos = 8 + headerLength;

  const tracks: SmfTrack[] = [];
  while (tracks.length < count && pos + 8 <= bytes.length) {
    const name = tag();
    const length = view.getUint32(pos + 4);
    const start = pos + 8;
    const end = Math.min(start + length, bytes.length);
    pos = end;
    if (name !== "MTrk") continue;
    tracks.push(readTrack(bytes, start, end));
  }
  return { format, ppq: division, tracks };
}

function readTrack(bytes: Uint8Array, start: number, end: number): SmfTrack {
  const events: SmfEvent[] = [];
  let pos = start;
  let tick = 0;
  let running = 0;
  const vlq = () => {
    let value = 0;
    for (let i = 0; i < 4 && pos < end; i++) {
      const b = bytes[pos++]!;
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return value;
  };
  const text = (from: number, length: number) => {
    const raw = bytes.subarray(from, from + length);
    // 트랙 이름은 Shift-JIS·CP949 등 제각각이라, UTF-8로 안 읽히면 latin1로 둔다
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return new TextDecoder("latin1").decode(raw);
    }
  };

  while (pos < end) {
    tick += vlq();
    let status = bytes[pos]!;
    if (status & 0x80) pos++;
    else status = running; // 러닝 스테이터스
    if (status === 0xff) {
      const type = bytes[pos++]!;
      const length = vlq();
      const data = pos;
      pos += length;
      if (type === 0x2f) return { events, endTick: tick };
      if (type === 0x51 && length >= 3) {
        events.push({ tick, type: "tempo", usPerQuarter: (bytes[data]! << 16) | (bytes[data + 1]! << 8) | bytes[data + 2]! });
      } else if (type === 0x58 && length >= 2) {
        events.push({ tick, type: "timeSig", beats: bytes[data]!, unit: 2 ** bytes[data + 1]! });
      } else if (type === 0x03) {
        events.push({ tick, type: "name", text: text(data, length) });
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      // 길이를 먼저 읽어야 길이 필드 자체를 건너뛴 만큼이 반영된다
      const length = vlq();
      pos += length;
      continue;
    }
    running = status;
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    const a = bytes[pos++]! & 0x7f;
    const twoBytes = kind !== 0xc0 && kind !== 0xd0;
    const b = twoBytes ? bytes[pos++]! & 0x7f : 0;
    if (kind === 0x90 && b > 0) events.push({ tick, type: "noteOn", channel, pitch: a, velocity: b });
    else if (kind === 0x80 || kind === 0x90) events.push({ tick, type: "noteOff", channel, pitch: a });
    else if (kind === 0xc0) events.push({ tick, type: "program", channel, program: a });
    else if (kind === 0xb0) events.push({ tick, type: "control", channel, control: a, value: b });
  }
  return { events, endTick: tick };
}

/** SMF 형식 1로 쓴다. 같은 tick의 이벤트는 끄기를 먼저 둔다 */
export function writeSmf(smf: Smf): Uint8Array {
  const out: number[] = [];
  const u32 = (v: number) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const u16 = (v: number) => out.push((v >>> 8) & 255, v & 255);
  out.push(..."MThd".split("").map((c) => c.charCodeAt(0)));
  u32(6);
  u16(smf.tracks.length > 1 ? 1 : smf.format);
  u16(smf.tracks.length);
  u16(smf.ppq);
  for (const track of smf.tracks) {
    const body = encodeTrack(track.events);
    out.push(..."MTrk".split("").map((c) => c.charCodeAt(0)));
    u32(body.length);
    for (const b of body) out.push(b);
  }
  return Uint8Array.from(out);
}

const ORDER: Record<SmfEvent["type"], number> = { name: 0, tempo: 1, timeSig: 2, program: 3, control: 4, noteOff: 5, noteOn: 6 };

function encodeTrack(events: readonly SmfEvent[]): number[] {
  const out: number[] = [];
  const vlq = (v: number) => {
    const bytes = [v & 0x7f];
    while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
    out.push(...bytes);
  };
  const sorted = [...events].sort((a, b) => a.tick - b.tick || ORDER[a.type] - ORDER[b.type]);
  let last = 0;
  for (const e of sorted) {
    vlq(e.tick - last);
    last = e.tick;
    switch (e.type) {
      case "noteOn":
        out.push(0x90 | e.channel, e.pitch, e.velocity);
        break;
      case "noteOff":
        out.push(0x80 | e.channel, e.pitch, 0);
        break;
      case "program":
        out.push(0xc0 | e.channel, e.program);
        break;
      case "control":
        out.push(0xb0 | e.channel, e.control, e.value);
        break;
      case "tempo":
        out.push(0xff, 0x51, 3, (e.usPerQuarter >> 16) & 255, (e.usPerQuarter >> 8) & 255, e.usPerQuarter & 255);
        break;
      case "timeSig":
        out.push(0xff, 0x58, 4, e.beats, Math.round(Math.log2(e.unit)), 24, 8);
        break;
      case "name": {
        const text = new TextEncoder().encode(e.text);
        out.push(0xff, 0x03);
        vlq(text.length);
        out.push(...text);
        break;
      }
    }
  }
  vlq(0);
  out.push(0xff, 0x2f, 0);
  return out;
}
