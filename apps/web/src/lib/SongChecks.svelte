<script lang="ts">
  import { barBeatAt, type Note, type Song, type Track } from "@mmlce/core";
  import type { SongDiagnostic } from "@mmlce/mml";
  import { diag, t } from "./i18n.svelte";

  /**
   * 곡 검사 목록 (상태줄의 "검사 N" 패널 안). 같은 경고(같은 트랙·같은 내용)는 한 줄로 묶고,
   * 음을 짚는 경고에는 "n마디 m박" 단추를 단다.
   */
  interface Props {
    song: Song;
    diagnostics: readonly SongDiagnostic[];
    /** 경고 위치로 가기 */
    ongo: (track: Track, note: Note) => void;
    /** 음색 경계를 넘는 &를 모두 끊기 (실행 취소 한 칸) */
    onbreaktimbre?: () => void;
    /** 접힘 검토 창 열기 */
    onfoldreview?: () => void;
  }

  let { song, diagnostics, ongo, onbreaktimbre, onfoldreview }: Props = $props();
  const timbreCount = $derived(diagnostics.filter((d) => d.code === "tie-across-boundary").length);

  function noteOf(d: SongDiagnostic): { track: Track; note: Note } | undefined {
    const track = song.tracks.find((tr) => tr.id === d.trackId);
    const note = track?.notes.find((n) => n.id === d.noteId);
    return track && note ? { track, note } : undefined;
  }

  function whereOf(d: SongDiagnostic): string {
    if (d.trackId) return song.tracks.find((tr) => tr.id === d.trackId)?.name ?? "";
    if (d.playerId) return song.players.find((p) => p.id === d.playerId)?.name ?? "";
    return "";
  }

  const groups = $derived.by(() => {
    const out = new Map<string, { key: string; level: string; code: string; where: string; text: string; items: { d: SongDiagnostic; label: string }[] }>();
    for (const d of diagnostics) {
      const text = diag(d);
      const key = `${d.level}|${d.trackId ?? d.playerId ?? ""}|${text}`;
      let g = out.get(key);
      if (!g) out.set(key, (g = { key, level: d.level, code: d.code, where: whereOf(d), text, items: [] }));
      const hit = noteOf(d);
      const at = hit ? barBeatAt(song.timeSig, hit.note.start) : undefined;
      g.items.push({ d, label: at ? t("ui.checkPlace", { bar: at.bar, beat: at.beat }) : "" });
    }
    // 오류 → 경고 → 정보 순
    const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return [...out.values()].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
  });

  /** 자리 단추를 모두 펼친 묶음 (처음엔 12개까지만) */
  let expanded = $state<ReadonlySet<string>>(new Set());
  const SHOWN = 12;

  function go(d: SongDiagnostic) {
    const hit = noteOf(d);
    if (hit) ongo(hit.track, hit.note);
  }
</script>

{#if groups.length > 0}
  <div class="checks">
    <strong>{t("ui.songChecks")} <span class="muted">{t("ui.checkCount", { count: diagnostics.length })}</span></strong>
    <ul class="notices">
      {#each groups as g (g.key)}
        <li class={g.level}>
          <span class="muted">{g.where}</span> {g.text}
          {#if g.items.length > 1}<span class="muted">×{g.items.length}</span>{/if}
          {#each expanded.has(g.key) ? g.items : g.items.slice(0, SHOWN) as item, k (k)}
            {#if item.label}<button class="small place" title={t("ui.checkGo")} onclick={() => go(item.d)}>{item.label}</button>{/if}
          {/each}
          {#if g.items.length > SHOWN && !expanded.has(g.key)}
            <button class="small" onclick={() => (expanded = new Set([...expanded, g.key]))}>{t("ui.checkMore", { count: g.items.length - SHOWN })}</button>
          {/if}
          {#if g.code === "pitch-fold" && onfoldreview}
            <button class="small" title={t("ui.foldReviewHelp")} onclick={onfoldreview}>{t("ui.foldReview")}…</button>
          {/if}
          {#if g.code === "tie-across-boundary" && onbreaktimbre}
            <button class="small" title={t("ui.breakTimbreTiesHelp")} onclick={onbreaktimbre}>{t("ui.breakTimbreTiesAll", { n: timbreCount })}</button>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
