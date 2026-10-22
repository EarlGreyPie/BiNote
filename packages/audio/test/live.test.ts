import { describe, expect, it } from "vitest";
import { LivePlayer, type LiveSink, type TimerHost } from "../src/live.js";
import type { Schedule } from "../src/schedule.js";

class FakeSink implements LiveSink {
  currentTime = 10;
  log: string[] = [];
  setPatch(channel: number, bank: number, program: number, time: number) {
    this.log.push(`patch ${channel} ${bank}/${program} @${time.toFixed(2)}`);
  }
  noteOn(channel: number, note: number, velocity: number, time: number) {
    this.log.push(`on ${channel} ${note} ${velocity} @${time.toFixed(2)}`);
  }
  noteOff(channel: number, note: number, time: number) {
    this.log.push(`off ${channel} ${note} @${time.toFixed(2)}`);
  }
  silence() {
    this.log.push("silence");
  }
  pitchBend(channel: number, semitones: number, time: number) {
    this.log.push(`bend ${channel} ${semitones} @${time.toFixed(2)}`);
  }
  setBendRange(channel: number, semitones: number, time: number) {
    this.log.push(`range ${channel} ${semitones} @${time.toFixed(2)}`);
  }
}

const manualTimers: TimerHost = { setInterval: () => 1, clearInterval: () => {} };

const schedule: Schedule = {
  slots: [{ key: "piano#", instrument: "piano" }],
  events: [
    { time: 0, type: "on", slot: 0, note: 60, velocity: 100, trackId: "t1" },
    { time: 0.5, type: "off", slot: 0, note: 60, velocity: 100, trackId: "t1" },
    { time: 0.5, type: "on", slot: 0, note: 62, velocity: 100, trackId: "t1" },
    { time: 1, type: "off", slot: 0, note: 62, velocity: 100, trackId: "t1" },
  ],
  duration: 1,
};
const patches = [{ slot: 0, channel: 0, bank: 1, program: 21, packId: "a" }];

describe("실시간 재생 예약", () => {
  it("앞쪽 일부만 예약하고 시간이 지나면 나머지를 예약한다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.3, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches);
    // 채널마다 패치·벤드 범위·벤드 0을 첫 음보다 먼저(지금) 정한다
    expect(sink.log).toEqual(["patch 0 1/21 @10.00", "range 0 24 @10.00", "bend 0 0 @10.00", "on 0 60 100 @10.10"]);

    sink.currentTime = 10.4;
    player.tick();
    expect(sink.log.slice(4)).toEqual(["off 0 60 @10.60", "on 0 62 100 @10.60"]);
    expect(player.position).toBeCloseTo(0.3);
  });

  it("곡이 소리 나기 시작하는 시각을 알려 준다 (원곡 맞추기용), 정지하면 없음", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { startDelay: 0.1, timers: manualTimers });
    expect(player.startTime).toBeUndefined();
    player.start(schedule, patches);
    expect(player.startTime).toBeCloseTo(10.1);
    player.stop();
    expect(player.startTime).toBeUndefined();
  });

  it("다른 음 붙임(bend)은 채널 높이만 옮긴다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 5, startDelay: 0.1, timers: manualTimers });
    player.start(
      { ...schedule, events: [
        { time: 0, type: "on", slot: 0, note: 60, velocity: 100, trackId: "t1" },
        { time: 0.5, type: "bend", slot: 0, note: 60, velocity: 100, trackId: "t1", bend: 2 },
        { time: 1, type: "off", slot: 0, note: 60, velocity: 100, trackId: "t1" },
      ] },
      patches,
    );
    expect(sink.log.slice(3)).toEqual(["on 0 60 100 @10.10", "bend 0 2 @10.60", "off 0 60 @11.10"]);
  });

  it("끝까지 가면 멈추고 알린다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { timers: manualTimers });
    let ended = false;
    player.onEnd = () => (ended = true);
    player.start(schedule, patches);
    sink.currentTime = 11.2;
    player.tick();
    expect(ended).toBe(true);
    expect(player.playing).toBe(false);
  });

  it("정지하면 소리를 끄고 더 예약하지 않는다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { timers: manualTimers });
    player.start(schedule, patches);
    player.stop();
    sink.currentTime = 12;
    player.tick();
    expect(sink.log.at(-1)).toBe("silence");
    expect(sink.log.filter((l) => l.startsWith("on"))).toHaveLength(1);
  });

  it("반복 구간은 멈추지 않고 경계에서 처음으로 이어 예약한다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.5, startDelay: 0.1, timers: manualTimers });
    const wraps: number[] = [];
    player.onWrap = (at) => wraps.push(at);
    // 0.75초 반복: 두 번째 음(0.5초)이 울리다 경계에서 끊기고 첫 음부터 다시
    player.start(schedule, patches, { loop: 0.75 });
    sink.currentTime = 10.5;
    player.tick();
    expect(wraps).toEqual([10.85]);
    expect(sink.log.slice(4)).toEqual(["off 0 60 @10.60", "on 0 62 100 @10.60", "off 0 62 @10.85", "on 0 60 100 @10.85"]);
    expect(player.playing).toBe(true);
    sink.currentTime = 10.9;
    expect(player.position).toBeCloseTo(0.05);
  });

  it("느리게 재생하면 음 사이가 늘어나고 위치는 곡 시간으로 잰다 (탭 템포 느리게 찍기)", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.3, startDelay: 0.1, timers: manualTimers });
    const ends: number[] = [];
    player.onEnd = () => ends.push(sink.currentTime);
    player.start(schedule, patches, { rate: 0.5 });
    expect(player.speed).toBe(0.5);
    // 곡 0.5초 자리 음은 오디오로 1초 뒤에 난다
    sink.currentTime = 10.85;
    player.tick();
    expect(sink.log.slice(4)).toEqual(["off 0 60 @11.10", "on 0 62 100 @11.10"]);
    // 오디오 1초가 흐르면 곡은 0.5초
    sink.currentTime = 11.1;
    expect(player.position).toBeCloseTo(0.5);
    expect(player.positionLagged(0.2)).toBeCloseTo(0.4);
    // 곡 길이 1초 = 오디오 2초 뒤에 끝난다
    sink.currentTime = 12.0;
    player.tick();
    expect(ends).toEqual([]);
    sink.currentTime = 12.15;
    player.tick();
    expect(ends).toEqual([12.15]);
    expect(player.speed).toBe(1);
  });

  it("느리게 반복하면 경계도 그 속도로 늘어난다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.5, startDelay: 0.1, timers: manualTimers });
    const wraps: number[] = [];
    player.onWrap = (at) => wraps.push(at);
    player.start(schedule, patches, { loop: 0.75, rate: 0.5 });
    sink.currentTime = 11.2;
    player.tick();
    expect(wraps).toEqual([11.6]);
    sink.currentTime = 11.7;
    expect(player.position).toBeCloseTo(0.05);
  });

  it("반복 구간 가운데(offset)부터 이어 재생하고, 다음 회차는 처음부터 (속도 바꾸기)", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.3, startDelay: 0.1, timers: manualTimers });
    const wraps: number[] = [];
    player.onWrap = (at) => wraps.push(at);
    player.start(schedule, patches, { loop: 0.75, rate: 0.5, offset: 0.5 });
    // 0.5초 앞 음(60)은 다시 치지 않고, 0.5초 자리 음(62)이 시작 시각(10.1)에 난다
    expect(sink.log.filter((l) => l.startsWith("on"))).toEqual(["on 0 62 100 @10.10"]);
    sink.currentTime = 10.1;
    expect(player.position).toBeCloseTo(0.5);
    expect(player.startTime).toBeCloseTo(9.1);
    // 남은 0.25초 = 오디오 0.5초 뒤 경계
    sink.currentTime = 10.5;
    player.tick();
    expect(wraps).toEqual([10.6]);
    sink.currentTime = 10.7;
    expect(player.position).toBeCloseTo(0.05);
  });

  it("속도가 0 이하거나 숫자가 아니면 원래 속도로 재생한다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.3, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches, { rate: 0 });
    expect(player.speed).toBe(1);
    player.start(schedule, patches, { rate: Number.NaN });
    expect(player.speed).toBe(1);
  });

  it("반복이 짧아도 화면 위치는 실제로 들리는 회차 기준이다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.3, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches, { loop: 0.125 });
    sink.currentTime = 10.12;
    player.tick();
    expect(player.position).toBeCloseTo(0.02);
  });

  it("다시 재생하면 앞 재생이 미리 넣은 예약이 다 지난 뒤에 시작한다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 1, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches);
    // 앞 재생은 10.60까지 끄기·켜기를 넣어 두었다
    sink.currentTime = 10.2;
    player.start(schedule, patches);
    expect(player.startTime!).toBeGreaterThan(10.6);
  });

  it("정지하면 아직 오지 않은 켜기도 바로 끈다 (신스 큐에 남은 음이 늦게 울리지 않게)", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 1, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches);
    sink.currentTime = 10.2;
    player.stop();
    expect(sink.log).toContain("off 0 62 @10.60");
    expect(sink.log.at(-1)).toBe("silence");
  });

  it("끊기를 쓸 수 있으면 아직 오지 않은 켜기를 끝소리 없이 자른다", () => {
    const sink = new FakeSink();
    const cuts: string[] = [];
    const cutting: LiveSink = Object.assign(sink, { cut: (channel: number, time: number) => void cuts.push(`cut ${channel} @${time.toFixed(2)}`) });
    const player = new LivePlayer(cutting, { lookahead: 1, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches);
    sink.currentTime = 10.2;
    player.stop();
    expect(cuts).toEqual(["cut 0 @10.60", "cut 0 @10.23"]);
    expect(sink.log).not.toContain("off 0 62 @10.60");
    expect(sink.log.at(-1)).toBe("silence");
  });

  it("소리 낼 패치가 없는 지점은 건너뛴다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { timers: manualTimers });
    player.start(schedule, []);
    sink.currentTime = 12;
    player.tick();
    expect(sink.log).toEqual([]);
  });

  it("출력 지연을 뺀 위치는 반복 회차를 접기 전에 뺀다", () => {
    const sink = new FakeSink();
    const player = new LivePlayer(sink, { lookahead: 0.3, startDelay: 0.1, timers: manualTimers });
    player.start(schedule, patches, { loop: 2 });
    // 시작(10.1) 뒤 2.1초 = 두 번째 회차 0.1초. 0.2초 지연이면 첫 회차 1.9초가 들리는 중
    sink.currentTime = 12.2;
    expect(player.positionLagged(0.2)).toBeCloseTo(1.9);
    expect(player.position).toBeCloseTo(0.1);
  });
});
