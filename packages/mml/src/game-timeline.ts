import { add, normalizeTempo, trackInstrument, type GameProfile, type Rat, type Song } from "@mmlce/core";
import { chordsPerScore } from "./clipboard.js";
import { mergeTies } from "./compare.js";
import { gameScores } from "./game-output.js";
import { parseMml } from "./parser.js";
import { audibleTempo } from "./tempo-text.js";

/** 게임 출력 시간표. 악보마다 템포·끝과, "악보 + 소리 묶음"마다 음 목록 */
export interface GameTimeline {
  /** 악보마다 한 줄: 그 악보 템포와 끝 (게임이 버리는 끝 쉼표를 뺀 길이) */
  readonly scores: readonly string[];
  /** "악보|소리 묶음" → 음 (시작|길이|높이|볼륨|&) 목록, 정렬됨 */
  readonly events: ReadonlyMap<string, readonly string[]>;
}

const r = (x: Rat) => `${x.n}/${x.d}`;

/**
 * 게임에 붙여넣을 최종 출력을 다시 읽은 시간표.
 * 악보마다 붙여넣는 글(MML@…; 오르골·축음기의 소리 없는 붙임 채널 포함)을 그대로 다시 읽어,
 * 그 악보 모든 채널에 적힌 템포와 그 악보의 끝, 소리 나는 채널의 음을 모은다.
 * 시간은 반올림 없이 분수 그대로 쓴다 (악보 템포가 같이 들어가므로 위치가 같으면 연주 시간도 같다).
 * 음은 트랙이 아니라 "악보 + 실제 악기 + 끄기·솔로·채널 볼륨·팬" 묶음으로 모은다:
 * 같은 악보 안에서 음이 다른 트랙으로 옮겨 가도 소리가 같으면 같은 결과가 나온다.
 * 악보 나뉨·악보마다의 끝이 바뀌면 다르다 (짧은 악보를 게임이 어떻게 다루든 상관없게).
 * player를 주면 그 연주자 악보만 본다 (악보는 연주자마다 따로 쓰므로 다른 연주자와 상관없다).
 */
export function gameTimelineOf(whole: Song, profile: GameProfile, player?: string): GameTimeline {
  const song =
    player === undefined
      ? whole
      : { ...whole, players: whole.players.filter((p) => p.id === player), tracks: whole.tracks.filter((t) => t.playerId === player) };
  const chords = chordsPerScore(song, profile);
  const scores: string[] = [];
  const events = new Map<string, string[]>();
  const count = new Map<string, number>();
  for (const score of gameScores(song, chords, profile.maxChordsPerPlayer, profile.charLimitPerScore)) {
    const index = count.get(score.playerId) ?? 0;
    count.set(score.playerId, index + 1);
    const name = `${score.playerId}#${index}`;
    const channels = score.text.replace(/^MML@/, "").replace(/;$/, "").split(",").map((text) => parseMml(text));
    const tempo = audibleTempo(normalizeTempo(channels.flatMap((c) => c.tempo)));
    const end = channels.reduce((m, c) => (c.gameEnd.n * m.d > m.n * c.gameEnd.d ? c.gameEnd : m), { n: 0, d: 1 } as Rat);
    scores.push(`${name} t=${tempo.map((e) => `${r(e.at)}:${e.bpm}`).join(";")} end=${r(end)}`);
    const size = Math.max(1, chords(score.playerId));
    score.pasted.forEach((id, k) => {
      const parsed = channels[k];
      // 오르골·축음기는 앞 size채널만 소리 낸다. 뒤 채널은 템포·길이에만 쓰인다
      if (!parsed || id === null || k >= size) return;
      const track = song.tracks.find((t) => t.id === id);
      if (!track) return;
      const inst = trackInstrument(song, track);
      const key = `${name}|${inst.canonical}|${inst.program ?? ""}|${track.mute}|${track.solo}|${track.mix?.volume ?? ""}|${track.mix?.pan ?? ""}`;
      const list = events.get(key) ?? [];
      for (const n of mergeTies(parsed.notes)) list.push(`${r(n.start)}|${r(add(n.start, n.dur))}|${n.pitch}|${n.vol}|${n.tie}`);
      events.set(key, list);
    });
  }
  for (const list of events.values()) list.sort();
  return { scores: scores.sort(), events };
}

/** 비교용 문자열 (gameTimelineOf를 한 글로) */
export function gameTimeline(whole: Song, profile: GameProfile, player?: string): string {
  return timelineText(gameTimelineOf(whole, profile, player));
}

/** 시간표를 비교용 한 글로 */
export function timelineText(t: GameTimeline): string {
  return [...t.scores, ...[...t.events].map(([key, list]) => `${key}:${list.join(",")}`).sort()].join("\n");
}

/**
 * after가 before의 소리를 그대로 담고 음만 더했는지 (빈 채널 채우기 뒤 검사용).
 * 악보 나뉨·템포·끝은 같아야 하고, 묶음마다 before의 음이 after에 모두 그대로 있어야 한다
 */
export function timelineCovers(after: GameTimeline, before: GameTimeline): boolean {
  if (after.scores.join("\n") !== before.scores.join("\n")) return false;
  for (const [key, list] of before.events) {
    const left = new Map<string, number>();
    for (const e of after.events.get(key) ?? []) left.set(e, (left.get(e) ?? 0) + 1);
    for (const e of list) {
      const n = left.get(e) ?? 0;
      if (n === 0) return false;
      left.set(e, n - 1);
    }
  }
  return true;
}
