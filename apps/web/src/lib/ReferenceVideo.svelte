<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "./i18n.svelte";
  import { loadStored, saveStored } from "./persist";
  import { clampFloatBox, defaultFloatBox, FLOAT_MIN_WIDTH, parseFloatBox, referenceVideoTime, type FloatBox } from "./referenceVideo";
  import { videoSyncStep } from "./roll";

  /**
   * 원곡 영상 떠 있는 창. 원곡을 영상 파일로 불러왔을 때 그 화면을 소리 없이 원곡과 같은 자리로 보여 준다
   * (소리는 엔진이 원곡으로 낸다). 머리줄을 끌어 옮기고 오른쪽 아래 귀퉁이로 크기를 바꾼다.
   * 브라우저가 PiP를 지원하면 [PiP] 단추로 브라우저 밖 항상 위 창으로 뺄 수 있다.
   * 단추는 눌러도 초점을 가져가지 않는다 (탭 템포 T 키가 계속 먹게).
   */
  interface Props {
    /** 원곡 파일 (영상) */
    file: File;
    /** 지금 곡 시간(초): 재생 중이면 재생 위치, 멈췄으면 커서 자리 */
    clock: number;
    playing: boolean;
    /** 재생 속도 (느리게 듣기) */
    rate: number;
    /** 원곡 어긋남 (ms, 원곡 줄과 같은 값) */
    offsetMs: number;
    onclose: () => void;
  }

  let { file, clock, playing, rate, offsetMs, onclose }: Props = $props();

  const BOX_KEY = "mmlce.referenceVideo.box";

  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  let url = $state<string | undefined>(undefined);
  /** 영상 화면이 없는 파일(소리만)이면 true */
  let noPicture = $state(false);
  let inPip = $state(false);
  let pipError = $state("");
  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  let box = $state<FloatBox>({ x: 0, y: 0, width: 320 });

  onMount(() => {
    const saved = loadStored(BOX_KEY, parseFloatBox);
    box = clampFloatBox(saved ?? defaultFloatBox(innerWidth, innerHeight), innerWidth, innerHeight);
    const onResize = () => (box = clampFloatBox(box, innerWidth, innerHeight));
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("resize", onResize);
      // 창을 닫으면 PiP 창도 닫는다 (안 그러면 원곡을 빼도 영상만 떠 있다)
      if (videoEl && document.pictureInPictureElement === videoEl) void document.exitPictureInPicture().catch(() => {});
    };
  });

  $effect(() => {
    const next = URL.createObjectURL(file);
    url = next;
    noPicture = false;
    return () => URL.revokeObjectURL(next);
  });

  /** 원곡 소리와 같은 자리로: 재생 중이면 곡 시간 + 어긋남을 따라가고, 멈췄으면 커서 자리 장면에 멈춘다 */
  $effect(() => {
    const el = videoEl;
    if (!el || !url) return;
    const want = referenceVideoTime(clock, offsetMs);
    if (playing) {
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const step = videoSyncStep(el.currentTime, want, el.paused);
      if (step.seek !== undefined) el.currentTime = step.seek;
      if (!step.play) {
        if (!el.paused) el.pause();
      } else if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      const at = Math.max(0, want);
      if (Math.abs(el.currentTime - at) > 0.05) el.currentTime = at;
    }
  });

  // PiP 창이 열리고 닫히는 것 (사용자가 PiP 창의 ✕로 닫아도 알 수 있게)
  $effect(() => {
    const el = videoEl;
    if (!el) return;
    const enter = () => (inPip = true);
    const leave = () => (inPip = false);
    el.addEventListener("enterpictureinpicture", enter);
    el.addEventListener("leavepictureinpicture", leave);
    return () => {
      el.removeEventListener("enterpictureinpicture", enter);
      el.removeEventListener("leavepictureinpicture", leave);
    };
  });

  function onMeta() {
    if (videoEl) noPicture = videoEl.videoWidth === 0;
  }

  /** PiP 창의 재생 단추로 곡이 멈춘 사이 영상만 돌면 다시 세운다 (곡과 어긋나지 않게) */
  function onPlay() {
    if (!playing) videoEl?.pause();
  }

  async function togglePip() {
    const el = videoEl;
    if (!el) return;
    pipError = "";
    try {
      if (document.pictureInPictureElement === el) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch (e) {
      pipError = t("ui.referenceVideoPipFailed");
      console.error(e);
    }
  }

  // 끌어 옮기기·크기 바꾸기
  let drag: { id: number; kind: "move" | "size"; x: number; y: number; from: FloatBox } | undefined;
  function startDrag(e: PointerEvent, kind: "move" | "size") {
    if (e.button !== 0) return;
    // 단추를 누르면 끌지 않는다
    if (kind === "move" && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, from: { ...box } };
  }
  function moveDrag(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const next = d.kind === "move" ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy } : { ...d.from, width: Math.max(FLOAT_MIN_WIDTH, d.from.width + dx) };
    box = clampFloatBox(next, innerWidth, innerHeight);
  }
  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = undefined;
    saveStored(BOX_KEY, JSON.stringify(box));
  }
</script>

<div class="ref-video" style:left="{box.x}px" style:top="{box.y}px" style:width="{box.width}px" role="dialog" aria-label={t("ui.referenceVideo")}>
  <div class="head" onpointerdown={(e) => startDrag(e, "move")} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} role="toolbar" tabindex="-1">
    <span class="title" title={file.name}>{t("ui.referenceVideo")}</span>
    {#if pipSupported && !noPicture}
      <button class="small" class:on={inPip} title={t("ui.referenceVideoPipHelp")} onpointerdown={(e) => e.preventDefault()} onclick={togglePip}>PiP</button>
    {/if}
    <button class="small" aria-label={t("ui.close")} title={t("ui.close")} onpointerdown={(e) => e.preventDefault()} onclick={onclose}>✕</button>
  </div>
  {#if noPicture}
    <p class="note">{t("ui.referenceVideoNoPicture")}</p>
  {:else if inPip}
    <p class="note">{t("ui.referenceVideoInPip")}</p>
  {/if}
  {#if pipError}<p class="note">{pipError}</p>{/if}
  <!-- 소리는 엔진이 원곡으로 내므로 영상은 늘 소리 없이. 조작 단추 없이 원곡 줄·탭 템포로만 움직인다 -->
  <video
    bind:this={videoEl}
    class:hidden={noPicture || inPip}
    src={url}
    muted
    playsinline
    preload="auto"
    disablepictureinpicture={!pipSupported}
    tabindex="-1"
    onloadedmetadata={onMeta}
    onplay={onPlay}
  ></video>
  <div class="size" onpointerdown={(e) => startDrag(e, "size")} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} role="separator" aria-label={t("ui.referenceVideoResize")} tabindex="-1"></div>
</div>

<style>
  .ref-video {
    position: fixed;
    z-index: 40;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    font-size: 13px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 10px;
    cursor: move;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  video {
    display: block;
    width: 100%;
    background: #000;
    pointer-events: none;
  }
  /* PiP 중에도 영상 요소는 문서에 남아 있어야 한다 (지우면 PiP 창이 닫힌다). 화면에서만 접는다 */
  video.hidden {
    height: 1px;
    opacity: 0;
  }
  .note {
    margin: 0;
    padding: 6px 10px;
    color: var(--muted);
  }
  .size {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
    touch-action: none;
    background: linear-gradient(135deg, transparent 50%, var(--muted) 50%, var(--muted) 58%, transparent 58%, transparent 70%, var(--muted) 70%, var(--muted) 78%, transparent 78%);
  }
</style>
