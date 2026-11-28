<script lang="ts">
  import type { GameProfile, Song } from "@mmlce/core";
  import { fewerScrolls, splitParts, type BookFit, type FewerScrolls } from "@mmlce/mml";
  import type { MessageKey } from "@mmlce/i18n";
  import { t } from "./i18n.svelte";

  /**
   * 파트마다 이어 읽는 악보책 (PC 자브키엘의 악보집, profile.scoreBook.perPart). 글자 수 맞추기 창의 악보책 칸.
   * 장마다 파트별 글자 수와 복사 단추, 악보집 크기(5·10장)를 넘으면 경고, 고르게 옮겨 장을 줄여 보기
   */
  interface Props {
    song: Song;
    profile: GameProfile;
    locked: ReadonlySet<string>;
    /** 고르게 옮기기 적용 (실행 취소 한 칸, 화음 분산 명령) */
    onfewer: (fit: BookFit) => void;
  }
  let { song, profile, locked, onfewer }: Props = $props();

  const split = $derived(splitParts(song, profile));
  const choices = $derived(profile.scoreBook.choices ?? [profile.scoreBook.maxScores]);
  let max = $state(0);
  const size = $derived(max || profile.scoreBook.maxScores);
  const slotName = (k: number) => (k <= 2 ? t(`ui.slot.${k}` as MessageKey) : String(k + 1));
  const nameOf = (id: string | null) => (id === null ? "" : (song.tracks.find((tr) => tr.id === id)?.name ?? id));
  const playerName = (playerId: string) => {
    const k = song.players.findIndex((p) => p.id === playerId);
    return k < 0 ? playerId : `${k + 1}. ${song.players[k]!.name}`;
  };

  let copied = $state("");
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
    } catch {
      copied = "";
    }
  }

  /** 장 줄여 보기 결과 (곡이 바뀌면 다시) */
  let fewer = $state.raw<{ song: Song; value: FewerScrolls | undefined | "checking" } | undefined>(undefined);
  const shown = $derived(fewer?.song === song ? fewer.value : undefined);
  const tried = $derived(fewer?.song === song);
  function tryFewer() {
    const target = song;
    fewer = { song: target, value: "checking" };
    // 계산이 길 수 있어 "찾는 중"을 먼저 그린다
    setTimeout(() => {
      const value = fewerScrolls(target, profile, locked);
      if (fewer?.song === target) fewer = { song: target, value };
    }, 20);
  }
</script>

<div class="scrolls">
  <p class="muted help">{t("ui.scrollHelp")}</p>
  {#if profile.exportNotice}<p class="note warn">{t(profile.exportNotice as MessageKey)}</p>{/if}
  <div class="headline">
    <strong>{t("ui.scrollCount", { count: split.scrolls })}</strong>
    {#if choices.length > 1}
      <label>
        {t("ui.scrollItem")}
        <select value={size} onchange={(e) => (max = Number(e.currentTarget.value))}>
          {#each choices as c (c)}<option value={c}>{t("ui.scrollCount", { count: c })}</option>{/each}
        </select>
      </label>
    {/if}
    {#if split.scrolls > size}<span class="warn">{t("ui.scrollOver", { max: size, count: split.scrolls })}</span>{/if}
  </div>

  {#if split.scrolls > 1}
    <div class="fewer">
      {#if shown === "checking"}
        <span class="muted" role="status">{t("ui.scrollFewerChecking")}</span>
      {:else if shown}
        <span>{t("ui.scrollFewerFound", { from: shown.from, to: shown.to })}</span>
        <button class="small" onclick={() => onfewer(shown.fit)}>{t("ui.scrollFewerApply")}</button>
      {:else if tried}
        <span class="muted">{t("ui.scrollFewerNone")}</span>
      {:else}
        <button class="small" onclick={tryFewer}>{t("ui.scrollFewer")}</button>
      {/if}
    </div>
  {/if}

  {#each split.books as book (`${book.playerId}:${book.index}`)}
    <section>
      <h3>{playerName(book.playerId)}{book.index > 0 ? ` #${book.index + 1}` : ""}</h3>
      {#if book.stuck.length > 0}<p class="warn">{t("ui.scrollStuck", { names: book.stuck.map(nameOf).join(", ") })}</p>{/if}
      <table>
        <thead>
          <tr>
            <th></th>
            {#each book.trackIds as id, k (k)}<th>{slotName(k)} <span class="muted">{nameOf(id)}</span></th>{/each}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each book.scrolls as scroll, s (s)}
            {@const key = `${book.playerId}:${book.index}:${s}`}
            <tr>
              <td>{t("ui.scrollRow", { n: s + 1 })}</td>
              {#each scroll.parts as part, k (k)}
                <td class="num" class:full={part.length > book.limits[k]!}>{part.length} <span class="muted">/ {book.limits[k]}</span></td>
              {/each}
              <td><button class="small" onclick={() => copy(key, scroll.text)}>{copied === key ? t("ui.copied") : t("ui.copy")}</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/each}
</div>

<style>
  .headline,
  .fewer {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: center;
    margin: 4px 0;
  }
  h3 {
    font-size: 1em;
    margin: 8px 0 4px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 2px 6px;
    text-align: left;
    border-bottom: 1px solid var(--line);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .full {
    color: var(--danger);
  }
</style>
