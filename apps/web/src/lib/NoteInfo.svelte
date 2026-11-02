<script lang="ts">
  import { cmp, eq, foldPitch, type Note, type PitchRange, type Rat, type TimeSigEvent } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { common, lengthText, parseLength, pitchText, positionText, ratText } from "./noteInfo";

  /**
   * 상태줄의 고른 음 정보: 높이(접히면 실제 높이), 마디:박, 시작 분수, 길이(바로 고쳐 쓰기), v, 이음.
   * 여러 음이면 같은 값만 보이고 다르면 "여러 값"
   */
  interface Props {
    notes: readonly Note[];
    timeSig: readonly TimeSigEvent[];
    /** 이 트랙 악기가 게임에서 내는 높이 범위 (밖이면 옥타브째 접힌다) */
    range: PitchRange;
    /** 실험실 소리 줄어듦: 음이 끝날 때 가장 클 때보다 몇 dB 작은지 (샘플이 먼저 끝나면 -Infinity). 없으면 안 보인다 */
    endDb?: number | undefined;
    /** 넣은 길이 적용. false면 바꾸지 않았다(물음에서 취소 등) — 칸을 지금 길이로 되돌린다 */
    onlength: (dur: Rat) => boolean | void;
  }

  let { notes, timeSig, range, endDb, onlength }: Props = $props();

  const first = $derived(notes[0]);
  const last = $derived(notes.reduce<Note | undefined>((m, n) => (!m || cmp(n.start, m.start) > 0 ? n : m), undefined));
  const dur = $derived(common(notes, (n) => n.dur, eq));
  const vol = $derived(common(notes, (n) => n.vol));
  const tie = $derived(common(notes, (n) => n.tie));
  const low = $derived(Math.min(...notes.map((n) => n.pitch)));
  const high = $derived(Math.max(...notes.map((n) => n.pitch)));

  function pitchLabel(p: number): string {
    const sounds = foldPitch(p, range);
    return sounds === p ? pitchText(p) : `${pitchText(p)}→${pitchText(sounds)}`;
  }

  let text = $state("");
  let bad = $state(false);
  // 고른 음이 바뀌면 칸을 그 길이로 다시 채운다
  $effect(() => {
    text = dur ? lengthText(dur) : "";
    bad = false;
  });

  function apply() {
    const next = parseLength(text);
    if (!next) {
      bad = text.trim() !== "";
      return;
    }
    bad = false;
    if ((!dur || !eq(dur, next)) && onlength(next) === false) text = dur ? lengthText(dur) : "";
  }
</script>

{#if first && last}
  <span class="item note-info" title={t("ui.noteInfoHelp")}>
    {#if notes.length === 1}
      <strong>{pitchLabel(first.pitch)}</strong>
      <span>{positionText(timeSig, first.start)}</span>
      <span class="muted">{t("ui.noteInfoStart", { at: ratText(first.start) })}</span>
    {:else}
      <strong>{t("ui.noteInfoCount", { count: notes.length })}</strong>
      <span>{low === high ? pitchLabel(low) : `${pitchText(low)}~${pitchText(high)}`}</span>
      <span>{positionText(timeSig, first.start)}~{positionText(timeSig, last.start)}</span>
    {/if}
    <label class="len" title={dur ? t("ui.noteInfoLengthExact", { length: ratText(dur) }) : t("ui.noteInfoLengthHelp")}>
      <span class="muted">{t("ui.noteInfoLength")}</span>
      <input
        class="num"
        class:bad
        size="5"
        bind:value={text}
        placeholder={dur ? "" : t("ui.noteInfoMixed")}
        aria-label={t("ui.noteInfoLength")}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            apply();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            text = dur ? lengthText(dur) : "";
            bad = false;
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        onchange={apply}
      />
    </label>
    <span>{vol === null ? t("ui.noteInfoVolMixed") : `v${vol}`}</span>
    {#if tie === "next"}<span title={t("cmd.note.tie")}>&amp;</span>{/if}
    {#if endDb !== undefined && endDb < -0.5}
      <span class="muted" title={t("ui.noteInfoFadeHelp")}>{Number.isFinite(endDb) ? t("ui.noteInfoFade", { db: Math.round(-endDb) }) : t("ui.noteInfoFadeSilent")}</span>
    {/if}
  </span>
{/if}

<style>
  .note-info {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .len {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  /* 길이 칸은 상태줄 안에 들어가게 (기본 컨트롤 높이는 터치 기기에서 상태줄보다 높다) */
  .num {
    width: 4.5em;
    min-height: 0;
    height: calc(var(--status-h) - 12px);
    padding: 0 4px;
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  .num.bad {
    border-color: var(--danger);
  }
</style>
