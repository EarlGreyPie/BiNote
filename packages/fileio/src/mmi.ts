import {
  cmp,
  emptySong,
  mul,
  rat,
  sub,
  trackInstrument,
  ZERO,
  type Marker,
  type Player,
  type Rat,
  type Song,
  type TempoEvent,
  type TimeSigEvent,
  type Track,
} from "@mmlce/core";
import { optimizeMml } from "@mmlce/mml";
import { channelToTrack, idMaker, instrumentFromProgram, mergeTempo, type ChannelTempo, type FileDiagnostic } from "./common.js";
import type { ReadResult } from "./threemle.js";

/**
 * 마비꼬 .mmi 파일. 공개된 파일 구조만 보고 독자 구현한다.
 *
 * [mml-score]  title, author, time=4/4, tempo=96T150,192T120 (tick T bpm),
 *              mml-track=MML@멜로디,화음1,화음2[,노래]; (다음 줄들이 들여쓰기로 이어짐)
 *              그 뒤 name, program, songProgram, startDelta 등이 그 트랙에 붙는다
 * [marker]     tick=이름
 * [time-signature] tick=n/d
 *
 * tick은 4분음표 = 96 (PC 마비노기 기준).
 */
export const MMI_TPQN = 96;
const WHOLE_TICKS = MMI_TPQN * 4;

/** 파트·연주자 이름. 앱이 화면 언어로 넘긴다 (기본 한국어) */
export interface MmiNames {
  readonly parts: readonly [string, string, string, string];
  readonly songPlayer: (name: string) => string;
}

const KO_NAMES: MmiNames = { parts: ["멜로디", "화음1", "화음2", "노래"], songPlayer: (name) => `${name} 노래` };

interface RawTrack {
  mml: string;
  props: Map<string, string>;
}

function tickToRat(tick: number): Rat {
  return rat(tick, WHOLE_TICKS);
}

function ratToTick(at: Rat): { tick: number; exact: boolean } {
  const exact = mul(at, rat(WHOLE_TICKS));
  const tick = Math.round(exact.n / exact.d);
  return { tick, exact: exact.d === 1 };
}

/**
 * .mmi를 곡으로 읽는다. mml-track 하나가 연주자 하나이고,
 * 그 안의 멜로디·화음1·화음2(·노래)를 각각 화음별 트랙으로 푼다.
 */
export function readMmi(text: string, names: MmiNames = KO_NAMES): ReadResult {
  const score = new Map<string, string>();
  const raws: RawTrack[] = [];
  const markers: Marker[] = [];
  const timeSig: TimeSigEvent[] = [];
  let section = "";
  let last: RawTrack | undefined;
  let lastKey = "";

  for (const line of text.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1]!;
      continue;
    }
    if (section === "mml-score") {
      // 들여쓴 줄은 바로 앞 mml-track 값의 이어지는 줄
      if (/^\s/.test(line) && lastKey === "mml-track" && last) {
        last.mml += line;
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      lastKey = key;
      if (key === "mml-track") {
        last = { mml: value, props: new Map() };
        raws.push(last);
      } else if (last) {
        last.props.set(key, value);
      } else {
        score.set(key, value);
      }
    } else if (section === "marker") {
      const m = /^(\d+)=(.*)$/.exec(line);
      if (m) markers.push({ id: `m${markers.length + 1}`, at: tickToRat(Number(m[1])), label: m[2]! });
    } else if (section === "time-signature") {
      const m = /^(\d+)=(\d+)\/(\d+)$/.exec(line);
      if (m) timeSig.push({ at: tickToRat(Number(m[1])), beats: Number(m[2]), unit: Number(m[3]) });
    }
  }

  const diagnostics: FileDiagnostic[] = [];
  const tempo: ChannelTempo[] = [];
  for (const item of (score.get("tempo") ?? "").split(",")) {
    const m = /^(\d+)T(\d+)$/.exec(item.trim());
    if (m) tempo.push({ at: tickToRat(Number(m[1])), bpm: Number(m[2]), channel: -1 });
  }

  const time = /^(\d+)\/(\d+)$/.exec(score.get("time") ?? "");
  if (time) timeSig.unshift({ at: ZERO, beats: Number(time[1]), unit: Number(time[2]) });

  const players: Player[] = [];
  const tracks: Track[] = [];
  const nextNoteId = idMaker("n");

  raws.forEach((raw, k) => {
    const body = raw.mml.replace(/^MML@/i, "").replace(/;\s*$/, "");
    const parts = body.split(",");
    const baseName = raw.props.get("name") || `Track${k + 1}`;
    const program = Number(raw.props.get("program") ?? 0) || 0;
    const songProgram = Number(raw.props.get("songProgram") ?? -1);
    const startDelta = Number(raw.props.get("startDelta") ?? 0) || 0;
    const startSongDelta = Number(raw.props.get("startSongDelta") ?? startDelta) || 0;

    const player: Player = { id: `p${players.length + 1}`, name: baseName, instrument: instrumentFromProgram(program) };
    players.push(player);
    let songPlayer: Player | undefined;

    parts.forEach((partText, partIndex) => {
      if (partText.trim() === "") return;
      const isSong = partIndex === 3;
      let owner = player;
      if (isSong) {
        // 노래 파트는 다른 악기(목소리)라 연주자를 따로 둔다
        songPlayer ??= {
          id: `p${players.length + 1}`,
          name: names.songPlayer(baseName),
          instrument: instrumentFromProgram(songProgram >= 0 ? songProgram : program),
        };
        if (!players.includes(songPlayer)) players.push(songPlayer);
        owner = songPlayer;
      }
      const delta = isSong ? startSongDelta : startDelta;
      tracks.push(
        channelToTrack(
          {
            name: `${baseName} ${names.parts[partIndex] ?? partIndex + 1}`,
            text: partText,
            player: owner,
            ...(delta ? { offset: tickToRat(delta) } : {}),
          },
          tracks.length,
          nextNoteId,
          tempo,
          diagnostics,
        ),
      );
    });
  });

  const base = emptySong({ title: score.get("title") ?? "", author: score.get("author") ?? "", profileId: "mobile" });
  const song: Song = {
    ...base,
    tempo: mergeTempo(tempo),
    timeSig: timeSig.sort((a, b) => cmp(a.at, b.at)),
    markers,
    players,
    tracks,
  };
  return { song, diagnostics };
}

/**
 * 곡을 .mmi 문자열로 쓴다. 연주자마다 트랙을 3개씩 묶어 멜로디·화음1·화음2에 넣는다.
 * 연주자 트랙이 3개를 넘으면 mml-track을 더 만든다.
 * 템포는 tempo= 줄과 첫 파트 본문에 같이 쓴다.
 */
export function writeMmi(song: Song): { text: string; diagnostics: FileDiagnostic[] } {
  const diagnostics: FileDiagnostic[] = [];
  const tempoItems: string[] = [];
  for (const t of song.tempo) {
    const { tick, exact } = ratToTick(t.at);
    if (!exact) {
      diagnostics.push({
        level: "warning",
        code: "tick-rounded",
        params: { bpm: t.bpm },
        span: [0, 0],
        where: "tempo",
      });
    }
    tempoItems.push(`${tick}T${t.bpm}`);
  }
  const sig = song.timeSig[0];
  const lines = [
    "[mml-score]",
    "version=1",
    `title=${song.meta.title}`,
    `author=${song.meta.author}`,
    `time=${sig?.beats ?? 4}/${sig?.unit ?? 4}`,
    `tempo=${tempoItems.join(",")}`,
  ];

  /** 저장할 악기 번호. 모바일 전용 악기(포크 기타 등)는 번호가 정해지지 않아 악보 악기 번호로 쓰고 알린다 */
  const programOf = (track: (typeof song.tracks)[number]) => {
    const inst = trackInstrument(song, track);
    if (inst.program !== undefined) return inst.program;
    const fallback = song.players.find((p) => p.id === track.playerId)?.instrument.program ?? 0;
    diagnostics.push({ level: "warning", code: "instrument-no-program", params: { instrument: inst.canonical, program: fallback }, span: [0, 0], where: track.name });
    return fallback;
  };
  let tempoWritten = false;
  for (const player of song.players) {
    const own = song.tracks.filter((t) => t.playerId === player.id);
    // mml-track 하나는 악기 하나라, 트랙 악기가 바뀌는 자리에서도 나눈다 (최대 3트랙)
    const groups: (typeof own)[] = [];
    for (const track of own) {
      const last = groups.at(-1);
      const key = (t: (typeof own)[number]) => trackInstrument(song, t).program ?? -1;
      if (last && last.length < 3 && key(last[0]!) === key(track)) last.push(track);
      else groups.push([track]);
    }
    for (const [g, group] of groups.entries()) {
      // 곡 시작보다 앞선 음(읽을 때 음수 startDelta로 당겨진 음)이 있으면 그만큼 startDelta로 되돌려 쓴다.
      // 출력기는 음수 위치의 음을 쓸 수 없어서, 파트 전체를 뒤로 민 다음 startDelta로 당긴다
      const earliest = group.flatMap((t) => t.notes.map((n) => n.start)).reduce<Rat>((a, b) => (cmp(a, b) <= 0 ? a : b), ZERO);
      const lead = cmp(earliest, ZERO) < 0 ? earliest : ZERO;
      const shift = (at: Rat) => sub(at, lead);
      const texts = group.map((track) => {
        // 4분음표 96칸 격자 밖의 음(9·7분음표 등). 마비꼬 1.5.12에서 이런 파일도 열리는 것은 확인했고, 위치는 격자로 맞춰질 수 있다
        const offGrid = track.notes.filter((n) => !ratToTick(n.start).exact || !ratToTick(n.dur).exact).length;
        if (offGrid > 0) {
          diagnostics.push({
            level: "warning",
            code: "mmi-off-grid",
            params: { count: offGrid },
            span: [0, 0],
            where: track.name,
          });
        }
        const notes = lead === ZERO ? track.notes : track.notes.map((n) => ({ ...n, start: shift(n.start) }));
        const tempo = tempoWritten ? [] : lead === ZERO ? song.tempo : song.tempo.map((t) => ({ ...t, at: shift(t.at) }));
        const printed = optimizeMml(notes, { tempo });
        tempoWritten = true;
        for (const d of printed.diagnostics) diagnostics.push({ ...d, where: track.name });
        return printed.text;
      });
      while (texts.length < 3) texts.push("");
      lines.push(
        `mml-track=MML@${texts.join(",")};`,
        `name=${groups.length > 1 ? `${player.name} ${g + 1}` : player.name}`,
        `program=${programOf(group[0]!)}`,
        "songProgram=-1",
        ...(lead === ZERO ? [] : [`startDelta=${ratToTick(lead).tick}`]),
        "panpot=64",
        "visible=true",
      );
    }
  }

  // 첫 박자는 time=에, 곡 중간 박자 변화는 [time-signature]에
  if (song.timeSig.length > 1) {
    lines.push("[time-signature]");
    for (const t of song.timeSig.slice(1)) lines.push(`${ratToTick(t.at).tick}=${t.beats}/${t.unit}`);
  }
  if (song.markers.length > 0) {
    lines.push("[marker]");
    for (const m of song.markers) lines.push(`${ratToTick(m.at).tick}=${m.label}`);
  }
  return { text: lines.join("\n") + "\n", diagnostics };
}
