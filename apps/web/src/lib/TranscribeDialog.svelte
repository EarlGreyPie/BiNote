<script lang="ts">
  import { analysisToTimedParts, analyzeMidi, readSmf, timedPartsToAnalysis, transcribeTimingFor, type MidiAnalysis, type TimedNote, type TranscribeTiming } from "@mmlce/midi";
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte";
  import {
    cancelJob,
    DEFAULT_BASIC_SCRIPTOR_PORT,
    jobResult,
    jobStatus,
    loadPort,
    pair,
    pairedToken,
    parsePort,
    probe,
    savePort,
    ScriptorAborted,
    ScriptorAuthError,
    ScriptorBusy,
    startJob,
    type ScriptorHealth,
    type ScriptorOptions,
  } from "./basicScriptor";
  import { pitchJob } from "./jobs";
  import { decodeForPitch, DEFAULT_PITCH_OPTIONS, PitchTooLong, pitchModelUrl, type PitchOptions } from "./pitchTranscribe";

  /**
   * 음원에서 받아 적기 (실험실): 음원을 음 목록(MIDI)으로 받아 적어 MIDI 불러오기 창으로 넘긴다.
   * - Basic Scriptor (PC만): 따로 켜 둔 Basic Scriptor 로컬 서버에 음원을 보낸다 (MuScriptor·basic-pitch, 세기 다듬기 sfproxy)
   * - 브라우저 안 (모든 기기): basic-pitch 모델을 이 브라우저에서 돌린다. 음원은 기기 밖으로 나가지 않는다
   * 지금 곡에 템포가 있으면(탭 템포로 원곡에 맞춘 것) 그 템포로 놓아 마디선이 원곡과 맞게 할 수 있다
   */
  interface Props {
    /** 불러온 원곡(배경 소리). 있으면 기본 음원 */
    reference: File | undefined;
    /** 지금 곡의 템포·박자와 원곡 어긋남. 곡이 없으면 undefined */
    timing: TranscribeTiming | undefined;
    /** PC 환경이면 Basic Scriptor를 고를 수 있다 */
    pc: boolean;
    /** 받아 적은 결과. fromReference: 원곡을 받아 적었는지, retimed: 곡 템포에 놓았는지 */
    onresult: (analysis: MidiAnalysis, name: string, info: { fromReference: boolean; retimed: boolean }) => void;
    onclose: () => void;
  }

  let { reference, timing, pc, onresult, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  // svelte-ignore state_referenced_locally
  let picked = $state.raw<File | undefined>(undefined);
  const audio = $derived(picked ?? reference);
  const fromReference = $derived(!picked && !!reference);
  // svelte-ignore state_referenced_locally
  let engine = $state<"scriptor" | "browser">(pc ? "scriptor" : "browser");
  // svelte-ignore state_referenced_locally
  let useSongTempo = $state(!!timing && !!reference);
  const retime = $derived(useSongTempo && !!timing);

  // Basic Scriptor
  let port = $state(loadPort());
  let portText = $state(String(loadPort()));
  let health = $state.raw<ScriptorHealth | undefined>(undefined);
  let checking = $state(false);
  let checked = $state(false);
  let paired = $state(false);
  let code = $state("");
  let pairError = $state("");
  let scriptorEngine = $state("");
  let velocity = $state("none");
  let instrument = $state<ScriptorOptions["instrument"]>("auto");

  async function check() {
    const next = parsePort(portText);
    port = next;
    portText = String(next);
    savePort(next);
    checking = true;
    health = await probe(next);
    checking = false;
    checked = true;
    paired = !!pairedToken(next);
    const ready = health?.engines.find((e) => e.ready);
    if (health && !health.engines.some((e) => e.id === scriptorEngine && e.ready)) scriptorEngine = ready?.id ?? "";
    if (health && velocity !== "none" && !health.velocity.includes(velocity)) velocity = "none";
  }

  $effect(() => {
    if (pc && engine === "scriptor" && !checked && !checking) void check();
  });

  function engineKey(e: KeyboardEvent) {
    if (running || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    engine = engine === "scriptor" ? "browser" : "scriptor";
    const group = e.currentTarget as HTMLElement;
    queueMicrotask(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  }

  async function doPair() {
    pairError = "";
    try {
      await pair(port, code);
      paired = true;
      code = "";
    } catch (e) {
      pairError = e instanceof ScriptorAuthError ? t("ui.transcribePairWrong") : e instanceof ScriptorBusy ? t("ui.transcribePairBusy") : t("ui.transcribeOffline");
    }
  }

  // 브라우저 안
  const SENSITIVITY = [
    { id: "few", label: "ui.transcribeFew", onset: 0.6, frame: 0.35 },
    { id: "normal", label: "ui.transcribeNormal", onset: 0.5, frame: 0.3 },
    { id: "many", label: "ui.transcribeMany", onset: 0.35, frame: 0.25 },
  ] as const;
  const MIN_MS = [30, 58, 100] as const;
  let sensitivity = $state<(typeof SENSITIVITY)[number]["id"]>("normal");
  let minMs = $state<number>(DEFAULT_PITCH_OPTIONS.minMs);

  // 진행
  let running = $state(false);
  let progress = $state(0);
  let stage = $state("");
  let error = $state("");
  let jobId: string | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  /** 받아 적기 차례 번호. 멈추거나 새로 시작하면 늘어나, 늦게 온 앞 차례의 답은 버린다 */
  let generation = 0;
  /** 이번 차례의 요청들 (멈추면 보내기·받기를 끊는다) */
  let abort: AbortController | undefined;
  /** 음원을 푸는 중 (풀기는 멈출 수 없어서, 끝날 때까지 새로 시작하지 않는다) */
  let decoding = $state(false);
  const job = pitchJob();

  function stop() {
    generation++;
    abort?.abort();
    abort = undefined;
    if (poll) clearTimeout(poll);
    poll = undefined;
    if (jobId) void cancelJob(port, jobId);
    jobId = undefined;
    job.cancel();
    running = false;
  }
  onDestroy(() => {
    stop();
    job.dispose();
  });

  let fileInput: HTMLInputElement;
  function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) picked = file;
  }

  const baseName = $derived((audio?.name ?? "audio").replace(/\.[^.]+$/, ""));

  function finish(build: () => MidiAnalysis, retimed: boolean, fromRef: boolean, scriptor: boolean) {
    running = false;
    let analysis: MidiAnalysis;
    try {
      analysis = build();
    } catch {
      error = t("ui.transcribeResultFailed");
      return;
    }
    if (analysis.parts.every((p) => p.notes.length === 0)) {
      error = t(scriptor ? "ui.transcribeEmptyScriptor" : "ui.transcribeEmpty");
      return;
    }
    onresult(analysis, `${baseName}.mid`, { fromReference: fromRef, retimed });
    dialog.close();
  }

  const canStart = $derived(!!audio && !running && !decoding && (engine === "browser" || (!!health && paired && !!scriptorEngine)));

  async function start() {
    if (!audio || !canStart) return;
    error = "";
    progress = 0;
    running = true;
    const run = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    // 시작할 때의 설정으로 끝까지 간다 (도중에 바꿔도 이번 결과에는 쓰지 않는다)
    const fromRef = fromReference;
    const when = transcribeTimingFor(timing, retime, fromRef);
    if (engine === "browser") await runBrowser(audio, run, when, fromRef);
    else await runScriptor(audio, run, when, fromRef, signal);
  }

  async function runBrowser(file: File, run: number, when: TranscribeTiming | undefined, fromRef: boolean) {
    stage = t("ui.transcribeDecoding");
    let samples: Float32Array;
    decoding = true;
    try {
      samples = await decodeForPitch(file);
    } catch (e) {
      if (run !== generation) return;
      running = false;
      error = e instanceof PitchTooLong ? t("ui.transcribeTooLong", { minutes: e.maxMinutes }) : t("ui.transcribeDecodeFailed", { name: file.name });
      return;
    } finally {
      decoding = false;
    }
    if (run !== generation) return;
    stage = t("ui.transcribeBrowserStage");
    const s = SENSITIVITY.find((x) => x.id === sensitivity) ?? SENSITIVITY[1];
    const options: PitchOptions = { ...DEFAULT_PITCH_OPTIONS, onset: s.onset, frame: s.frame, minMs };
    const notes = await job.run({ samples, modelUrl: pitchModelUrl(), options }, (p) => {
      if (run === generation) progress = p;
    });
    if (run !== generation) return;
    if (!notes) {
      running = false;
      error = t("ui.transcribeBrowserFailed");
      return;
    }
    finish(() => timedPartsToAnalysis([{ name: "basic-pitch", channel: 0, program: 0, notes: notes as readonly TimedNote[] }], when), !!when, fromRef, false);
  }

  async function runScriptor(file: File, run: number, when: TranscribeTiming | undefined, fromRef: boolean, signal: AbortSignal) {
    stage = t("ui.transcribeSending");
    const at = port;
    try {
      const id = await startJob(at, file, file.name, { engine: scriptorEngine, velocity, instrument }, fetch, signal);
      if (run !== generation) {
        // 보내는 동안 멈췄으면 서버에서 시작된 일도 멈춘다
        void cancelJob(at, id);
        return;
      }
      jobId = id;
    } catch (e) {
      if (run !== generation || e instanceof ScriptorAborted) return;
      running = false;
      if (e instanceof ScriptorAuthError) paired = false;
      error = e instanceof ScriptorAuthError ? t("ui.transcribePairAgain") : t("ui.transcribeScriptorFailed", { message: e instanceof Error ? e.message : "" });
      return;
    }
    const id = jobId;
    const tick = async () => {
      if (run !== generation) return;
      try {
        const s = await jobStatus(at, id, fetch, signal);
        if (run !== generation) return;
        progress = s.progress;
        stage = s.stage || t("ui.transcribeScriptorStage");
        if (s.state === "done") {
          const bytes = await jobResult(at, id, fetch, signal);
          if (run !== generation) return;
          jobId = undefined;
          finish(
            () => {
              const raw = analyzeMidi(readSmf(bytes));
              return when ? timedPartsToAnalysis(analysisToTimedParts(raw), when) : raw;
            },
            !!when,
            fromRef,
            true,
          );
          return;
        }
        if (s.state === "failed" || s.state === "cancelled") {
          jobId = undefined;
          running = false;
          error = t("ui.transcribeScriptorFailed", { message: s.message });
          return;
        }
      } catch (e) {
        if (run !== generation || e instanceof ScriptorAborted) return;
        running = false;
        // 묻기가 한 번 실패해도 서버에서는 계속 돌 수 있다: 일 번호를 잊기 전에 멈추라고 보낸다
        void cancelJob(at, id);
        jobId = undefined;
        if (e instanceof ScriptorAuthError) paired = false;
        error = e instanceof ScriptorAuthError ? t("ui.transcribePairAgain") : t("ui.transcribeOffline");
        return;
      }
      poll = setTimeout(tick, 700);
    };
    poll = setTimeout(tick, 300);
  }
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="transcribe-title">
  <h2 id="transcribe-title">{t("ui.labTranscribe")}</h2>
  <div class="row">
    <span class="name">{t("ui.transcribeAudio")}</span>
    <span class="file">{audio ? audio.name : t("ui.transcribeNoAudio")}{#if fromReference}<span class="muted"> ({t("ui.transcribeReference")})</span>{/if}</span>
    <button disabled={running} onclick={() => fileInput.click()}>{t("ui.transcribePick")}</button>
    {#if picked && reference}<button disabled={running} onclick={() => (picked = undefined)}>{t("ui.transcribeUseReference")}</button>{/if}
    <input bind:this={fileInput} type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a" onchange={pick} disabled={running} hidden />
  </div>

  {#if pc}
    <!-- 라디오 묶음: 화살표 키로 다른 쪽을 고르고 그 단추로 초점을 옮긴다 -->
    <div class="seg" role="radiogroup" tabindex="-1" aria-label={t("ui.transcribeEngine")} onkeydown={engineKey}>
      <button role="radio" tabindex={engine === "scriptor" ? 0 : -1} aria-checked={engine === "scriptor"} class:on={engine === "scriptor"} disabled={running} onclick={() => (engine = "scriptor")}>Basic Scriptor (PC)</button>
      <button role="radio" tabindex={engine === "browser" ? 0 : -1} aria-checked={engine === "browser"} class:on={engine === "browser"} disabled={running} onclick={() => (engine = "browser")}>{t("ui.transcribeBrowser")}</button>
    </div>
  {/if}

  {#if engine === "scriptor" && pc}
    <div class="box">
      {#if checking}
        <p class="muted">{t("ui.transcribeChecking")}</p>
      {:else if !health}
        <p class="warn">{t("ui.transcribeNotFound")}</p>
        <p class="muted">{t("ui.transcribeNotFoundHelp")}</p>
      {:else}
        <p class="ok">{t("ui.transcribeFound", { version: health.version || "?" })}</p>
      {/if}
      <div class="row">
        <label>{t("ui.transcribePort")} <input class="num" type="number" min="1024" max="65535" placeholder={String(DEFAULT_BASIC_SCRIPTOR_PORT)} bind:value={portText} disabled={running} /></label>
        <button onclick={check} disabled={checking || running}>{t("ui.transcribeCheck")}</button>
      </div>
      {#if health && !paired}
        <p class="muted">{t("ui.transcribePairHelp")}</p>
        <div class="row">
          <input class="code" inputmode="numeric" autocomplete="off" aria-label={t("ui.transcribePairCode")} bind:value={code} placeholder="000000" onkeydown={(e) => e.key === "Enter" && !e.isComposing && doPair()} />
          <button class="primary" onclick={doPair} disabled={code.trim() === ""}>{t("ui.transcribePair")}</button>
        </div>
        {#if pairError}<p class="warn">{pairError}</p>{/if}
      {/if}
      {#if health && paired}
        <div class="row">
          <label class="name" for="transcribe-engine">{t("ui.transcribeEngine")}</label>
          <select id="transcribe-engine" bind:value={scriptorEngine} disabled={running}>
            {#each health.engines as e (e.id)}
              <option value={e.id} disabled={!e.ready}>{e.label}{e.ready ? "" : ` (${t("ui.transcribeNotReady")})`}</option>
            {/each}
          </select>
        </div>
        {#if !health.engines.some((e) => e.ready)}<p class="warn">{t("ui.transcribeNoEngine")}</p>{/if}
        <div class="row">
          <label class="name" for="transcribe-velocity">{t("ui.transcribeVelocity")}</label>
          <select id="transcribe-velocity" bind:value={velocity} disabled={running}>
            <option value="none">{t("ui.transcribeVelocityNone")}</option>
            {#each health.velocity as v (v)}<option value={v}>{v}</option>{/each}
          </select>
          <div class="seg" role="group">
            <button aria-pressed={instrument === "auto"} class:on={instrument === "auto"} disabled={running} onclick={() => (instrument = "auto")}>{t("ui.transcribeAuto")}</button>
            <button aria-pressed={instrument === "piano"} class:on={instrument === "piano"} disabled={running} onclick={() => (instrument = "piano")}>{t("ui.transcribePiano")}</button>
            <button aria-pressed={instrument === "guitar"} class:on={instrument === "guitar"} disabled={running} onclick={() => (instrument = "guitar")}>{t("ui.transcribeGuitar")}</button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="box">
      <p class="muted">{t("ui.transcribeBrowserHelp")}</p>
      <div class="row">
        <span class="name" id="transcribe-sensitivity">{t("ui.transcribeSensitivity")}</span>
        <div class="seg" role="group" aria-labelledby="transcribe-sensitivity">
          {#each SENSITIVITY as s (s.id)}
            <button aria-pressed={sensitivity === s.id} class:on={sensitivity === s.id} disabled={running} onclick={() => (sensitivity = s.id)}>{t(s.label)}</button>
          {/each}
        </div>
      </div>
      <div class="row">
        <span class="name" id="transcribe-min-length">{t("ui.transcribeMinLength")}</span>
        <div class="seg" role="group" aria-labelledby="transcribe-min-length">
          {#each MIN_MS as ms (ms)}
            <button aria-pressed={minMs === ms} class:on={minMs === ms} disabled={running} onclick={() => (minMs = ms)}>{ms} ms</button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <label class="check" title={t("ui.transcribeSongTempoHelp")}>
    <input type="checkbox" bind:checked={useSongTempo} disabled={!timing || running} />
    {t("ui.transcribeSongTempo")}
  </label>
  {#if !timing}<p class="muted small">{t("ui.transcribeNoSong")}</p>{:else if useSongTempo && !fromReference}<p class="muted small">{t("ui.transcribeNotReference")}</p>{/if}
  <p class="muted small">{t("ui.transcribeRights")}</p>

  {#if running}
    <div class="progress"><div class="bar" style:width={`${Math.round(progress * 100)}%`}></div></div>
    <p class="muted">{stage} {Math.round(progress * 100)}%</p>
  {/if}
  {#if error}<p class="warn">{error}</p>{/if}

  <div class="actions">
    <span class="spacer"></span>
    {#if running}
      <button onclick={stop}>{t("ui.transcribeStop")}</button>
    {/if}
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!canStart} onclick={start}>{t("ui.transcribeStart")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .row .seg {
    margin-top: 0;
  }
  .name {
    min-width: 4em;
  }
  .file {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .box {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 10px 10px;
    margin-top: 8px;
  }
  .num {
    width: 6em;
  }
  .code {
    width: 8em;
    font-size: 1.05rem;
    letter-spacing: 0.1em;
  }
  .check {
    display: block;
    margin-top: 10px;
  }
  .progress {
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    margin-top: 10px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent, #4a8);
  }
  .warn {
    color: var(--warn, #c48a00);
    margin: 6px 0 0;
  }
  .ok {
    margin: 6px 0 0;
  }
  .muted {
    margin: 6px 0 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
</style>
