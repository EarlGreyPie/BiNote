<script lang="ts">
  import { getContext, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { t } from "./i18n.svelte";
  import { SETTINGS_HELP, type SettingsHelp } from "./settingsHelp";

  /**
   * 설정 창의 한 줄: 왼쪽 이름 · 오른쪽 조작. 설명이 있으면 이름 옆 ⓘ를 눌러 줄 밑에 펼친다.
   * 마우스를 올려야만 보이는 글(title)은 아이패드에서 못 보므로 설명은 늘 ⓘ로 연다
   */
  interface Props {
    label: string;
    /** 이름을 이 id의 조작에 잇는다 (이름을 눌러도 그 조작이 잡힌다) */
    for?: string;
    help?: string;
    /** 오른쪽 조작 */
    children?: Snippet;
    /** 줄 밑에 늘 보이는 것 (예: 고른 폴더) */
    below?: Snippet;
  }
  let { label, for: forId, help, children, below }: Props = $props();

  const uid = $props.id();
  const shared = getContext<SettingsHelp | undefined>(SETTINGS_HELP);
  let open = $state(false);
  // "설명 모두 펼치기/접기"를 누르면 그 값으로 맞춘다
  $effect(() => {
    open = shared?.all ?? false;
  });
</script>

<div class="item">
  <div class="line">
    <span class="name">
      {#if forId}<label for={forId}>{label}</label>{:else}<span>{label}</span>{/if}
      {#if help}
        <button
          class="info"
          class:on={open}
          aria-expanded={open}
          aria-controls={`${uid}-help`}
          aria-label={t("ui.settingHelpFor", { name: label })}
          onclick={() => (open = !open)}><Icon name="info" /></button
        >
      {/if}
    </span>
    {#if children}<span class="ctl">{@render children()}</span>{/if}
  </div>
  {#if help}<p class="help" id={`${uid}-help`} hidden={!open}>{help}</p>{/if}
  {#if below}<div class="below">{@render below()}</div>{/if}
</div>

<style>
  .item + :global(.item) {
    border-top: 1px solid var(--line);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 40px;
    padding: 4px 0;
    box-sizing: border-box;
  }
  .name {
    flex: 1 1 auto;
    min-width: 7em;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .name label {
    cursor: pointer;
  }
  .ctl {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
  }
  .info {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
  }
  .info :global(svg) {
    width: 16px;
    height: 16px;
  }
  .info.on {
    color: var(--accent);
  }
  .help {
    margin: 0;
    padding: 0 0 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .below {
    padding: 0 0 8px;
  }
</style>
