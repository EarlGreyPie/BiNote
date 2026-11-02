<script lang="ts">
  import type { Track } from "@mmlce/core";

  /**
   * 고른 음이 여러 줄(트랙)에 있을 때 쓸 줄을 체크로 고르는 줄 (슬라이드·트릴·트레몰로·꾸밈음 창).
   * 체크를 끈 트랙 id를 excluded로 돌려준다
   */
  interface Props {
    tracks: readonly Pick<Track, "id" | "name" | "color">[];
    excluded: ReadonlySet<string>;
    /** 보이는 트랙 색 (없으면 트랙에 적힌 색) */
    colors?: ReadonlyMap<string, string> | undefined;
    label: string;
    help: string;
    onchange: (excluded: ReadonlySet<string>) => void;
  }
  let { tracks, excluded, colors, label, help, onchange }: Props = $props();

  function toggle(id: string, on: boolean) {
    const next = new Set(excluded);
    if (on) next.delete(id);
    else next.add(id);
    onchange(next);
  }
</script>

<div class="row tracks" role="group" aria-label={label} title={help}>
  <span>{label}</span>
  {#each tracks as tr (tr.id)}
    <label>
      <input type="checkbox" checked={!excluded.has(tr.id)} onchange={(e) => toggle(tr.id, e.currentTarget.checked)} />
      <span class="dot" style:background={colors?.get(tr.id) ?? tr.color}></span>{tr.name}
    </label>
  {/each}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
</style>
