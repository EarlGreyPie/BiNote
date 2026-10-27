import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, type Song } from "@mmlce/core";
import { parseTrackText, planBooks, splitSong, type BookPlan, type BookProgress } from "@mmlce/mml";
import { planSplit, splitJob, type SplitRequest } from "../src/lib/jobs";
import { WorkerJob, type JobReply, type JobRequest } from "../src/lib/workerJob";
type SplitReply = JobReply<BookPlan, BookProgress>;

const profile = { ...MOBILE_PROFILE, charLimitPerScore: 40 };
const song: Song = {
  ...emptySong({ title: "", author: "", profileId: "mobile" }),
  players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
  tracks: [
    { id: "a", playerId: "p1", name: "a", color: "", role: "free", mute: false, solo: false, notes: parseTrackText("a", { text: "cdefgab>c<".repeat(6) }).notes, spelling: {} },
  ],
};

/** 화음 분산을 끈 나누기 요청 (트랙이 하나라 어차피 옮길 곳도 없다) */
const request: SplitRequest = { song, profile, spread: false, thorough: false };

/** 실제 워커 대신: 받은 요청을 같은 planSplit으로 계산해 다음 틱에 답한다 */
class FakeWorker {
  onmessage: ((e: MessageEvent<SplitReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly fail = false) {}
  postMessage({ id, request }: JobRequest<SplitRequest>) {
    setTimeout(() => {
      if (this.terminated) return;
      if (this.fail) {
        this.onerror?.({ preventDefault() {} } as ErrorEvent);
        return;
      }
      const send = (data: SplitReply) => this.onmessage?.({ data } as MessageEvent<SplitReply>);
      const result = planSplit(request, (progress) => send({ id, progress }));
      send({ id, result });
    }, 0);
  }
  terminate() {
    this.terminated = true;
  }
}

describe("WorkerJob (악보책 나누기)", () => {
  it("워커로 나누고 진행률을 알린다", async () => {
    const runner = splitJob(() => new FakeWorker() as unknown as Worker);
    const seen: number[] = [];
    const result = await runner.run(request, (p) => seen.push(p.fraction));
    expect(result).toEqual(planBooks(song, profile, { spread: false }));
    expect(result!.result).toEqual(splitSong(song, profile));
    expect(result!.result.parts.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(runner.busy).toBe(false);
  });

  it("취소하면 undefined로 끝나고 워커를 멈춘다", async () => {
    const workers: FakeWorker[] = [];
    const runner = splitJob(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    const running = runner.run(request);
    runner.cancel();
    expect(await running).toBeUndefined();
    expect(workers[0]!.terminated).toBe(true);
    // 다음 요청은 새 워커로
    expect(await runner.run(request)).toBeDefined();
    expect(workers.length).toBe(2);
  });

  it("새로 시작하면 앞 요청은 undefined, 뒤 요청만 결과를 받는다", async () => {
    const runner = splitJob(() => new FakeWorker() as unknown as Worker);
    const first = runner.run(request);
    const second = runner.run(request);
    expect(await first).toBeUndefined();
    expect(await second).toBeDefined();
  });

  it("워커가 실패하거나 없으면 화면 쪽에서 계산한다", async () => {
    const plan = planBooks(song, profile, { spread: false });
    expect(await splitJob(() => new FakeWorker(true) as unknown as Worker).run(request)).toEqual(plan);
    expect(await splitJob(undefined).run(request)).toEqual(plan);
  });

  it("화면 쪽 계산은 취소된 뒤 진행률을 알리지 않고 다음 보고에서 멈춘다", async () => {
    let release!: () => void;
    const loaded = new Promise<void>((r) => (release = r));
    let steps = 0;
    // 느린 모듈 불러오기 뒤 진행률을 알리며 계산하는 local
    const runner = new WorkerJob<number, number>(undefined, async (n, onProgress) => {
      await loaded;
      for (let i = 1; i <= n; i++) {
        onProgress(i / n);
        steps++;
      }
      return n;
    });
    const seen: number[] = [];
    const running = runner.run(5, (p) => seen.push(p));
    await new Promise((r) => setTimeout(r, 40));
    runner.cancel();
    release();
    expect(await running).toBeUndefined();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([]);
    expect(steps).toBe(0);
    expect(runner.busy).toBe(false);
    // 다음 요청은 정상으로
    const again: number[] = [];
    expect(await runner.run(2, (p) => again.push(p))).toBe(2);
    expect(again).toEqual([0.5, 1]);
  });
});

describe("WorkerJob 정리", () => {
  it("dispose는 쉬고 있는 워커도 끝내고, 다시 쓰면 새 워커를 만든다", async () => {
    const workers: FakeWorker[] = [];
    const runner = splitJob(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    await runner.run(request);
    expect(workers).toHaveLength(1);
    runner.cancel(); // 돌던 계산이 없으면 cancel은 워커를 두고
    expect(workers[0]!.terminated).toBe(false);
    runner.dispose(); // dispose는 끝낸다
    expect(workers[0]!.terminated).toBe(true);
    expect(await runner.run(request)).toBeDefined();
    expect(workers).toHaveLength(2);
  });

  it("dispose는 돌던 계산을 undefined로 끝낸다", async () => {
    const runner = splitJob(() => new FakeWorker() as unknown as Worker);
    const pending = runner.run(request);
    runner.dispose();
    expect(await pending).toBeUndefined();
    expect(runner.busy).toBe(false);
  });
});

