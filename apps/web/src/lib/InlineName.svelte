<script lang="ts">
  /** 두 번 누르면 그 자리에서 고치는 이름. Enter·포커스를 잃으면 반영, Esc는 취소 */
  interface Props {
    value: string;
    title: string;
    onrename: (name: string) => void;
  }

  let { value, title, onrename }: Props = $props();
  let editing = $state(false);
  let draft = $state("");

  function start(e: MouseEvent) {
    e.stopPropagation();
    draft = value;
    editing = true;
  }

  function finish(commit: boolean) {
    if (!editing) return;
    editing = false;
    if (commit && draft.trim() !== "" && draft.trim() !== value) onrename(draft.trim());
  }

  function focus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

{#if editing}
  <input
    class="inline-name"
    bind:value={draft}
    use:focus
    onclick={(e) => e.stopPropagation()}
    onblur={() => finish(true)}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    }}
  />
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <strong class="inline-name" {title} ondblclick={start}>{value}</strong>
{/if}

<style>
  input.inline-name {
    font: inherit;
    font-weight: 600;
    width: 10em;
    padding: 0 4px;
  }
  strong.inline-name {
    cursor: text;
  }
</style>
