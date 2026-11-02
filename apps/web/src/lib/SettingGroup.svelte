<script lang="ts">
  import type { Snippet } from "svelte";

  /** 설정 창의 묶음 상자: 작은 제목 + 줄들을 담는 상자 */
  interface Props {
    title?: string;
    /** 상자를 흐리게 (실험실이 꺼져 있을 때 기능 목록) */
    dim?: boolean;
    children: Snippet;
  }
  let { title, dim = false, children }: Props = $props();
</script>

<section class="group" class:dim>
  {#if title}<h3>{title}</h3>{/if}
  <div class="box">{@render children()}</div>
</section>

<style>
  .group {
    display: grid;
    min-width: 0;
  }
  h3 {
    margin: 0 0 4px 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .box {
    background: color-mix(in srgb, var(--bg) 70%, var(--panel));
    border: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
    border-radius: 8px;
    padding: 0 12px;
    min-width: 0;
  }
  .dim .box {
    opacity: 0.6;
  }
</style>
