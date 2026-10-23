import { SCAN_WIDTH, tintedCount, toLevels, type ScanSample } from "./videoBars";

/**
 * 실험실 영상 마디 넘김: 배경 영상을 보이지 않는 곳에서 한 번 재생하며 프레임마다 줄여 읽는다.
 * 화면의 배경 영상은 건드리지 않는다. requestVideoFrameCallback이 있으면 프레임 시각을 정확히 쓰고,
 * 없으면 화면 새로 그릴 때마다 지금 시각을 읽는다
 */
export interface ScanResult {
  readonly samples: ScanSample[];
  /** 줄인 프레임 점 수 */
  readonly pixels: number;
  /** 끝까지 읽었는지 (그만두면 false) */
  readonly complete: boolean;
}

type FrameCallback = (now: number, meta: { mediaTime: number }) => void;
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCallback) => number };

export function scanVideo(url: string, options: { rate: number; onprogress: (share: number) => void; signal: AbortSignal }): Promise<ScanResult> {
  const { rate, onprogress, signal } = options;
  const el = document.createElement("video") as FrameVideo;
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  // 아이패드는 화면에 없는 영상의 프레임을 안 그릴 수 있어 아주 작게 붙여 둔다
  el.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none";
  document.body.append(el);
  return new Promise<ScanResult>((resolve, reject) => {
    const samples: ScanSample[] = [];
    let canvas: HTMLCanvasElement | undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    let prev: Uint8Array | undefined;
    let lastTime = -1;
    let pixels = 0;
    let done = false;
    const finish = (complete: boolean, error?: unknown) => {
      if (done) return;
      done = true;
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.remove();
      signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve({ samples, pixels, complete });
    };
    const abort = () => finish(false);
    const read = (time: number) => {
      if (done || !ctx || !canvas || time <= lastTime) return;
      lastTime = time;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      // 다른 곳에서 온 영상이면 여기서 SecurityError (배경 영상은 내 파일이라 생기지 않는다)
      const levels = toLevels(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      samples.push({ time, count: prev ? tintedCount(prev, levels) : 0 });
      prev = levels;
      if (el.duration > 0) onprogress(Math.min(1, time / el.duration));
    };
    const loop = () => {
      if (done) return;
      if (el.requestVideoFrameCallback) {
        el.requestVideoFrameCallback((_now, meta) => {
          try {
            read(meta.mediaTime);
          } catch (e) {
            finish(false, e);
            return;
          }
          loop();
        });
      } else {
        requestAnimationFrame(() => {
          try {
            if (!el.paused) read(el.currentTime);
          } catch (e) {
            finish(false, e);
            return;
          }
          loop();
        });
      }
    };
    signal.addEventListener("abort", abort);
    if (signal.aborted) return finish(false);
    el.addEventListener("error", () => finish(false, el.error ?? new Error("video")));
    el.addEventListener("ended", () => finish(true));
    el.addEventListener(
      "loadedmetadata",
      () => {
        if (done) return;
        const w = SCAN_WIDTH;
        const h = Math.max(1, Math.round((SCAN_WIDTH * (el.videoHeight || 9)) / (el.videoWidth || 16)));
        canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        ctx = canvas.getContext("2d", { willReadFrequently: true });
        pixels = w * h;
        if (!ctx) return finish(false, new Error("canvas"));
        el.playbackRate = rate;
        loop();
        el.play().catch((e: unknown) => finish(false, e));
      },
      { once: true },
    );
    el.src = url;
  });
}
