<script lang="ts" module>
  /** 화음↔트랙 정리 방식: 고른 음 옮기기 / 트랙 합치기 / 높이 순으로 다시 나누기 */
  export type VoiceMode = "move" | "merge" | "voice";

  export interface VoiceOptions {
    /** 옮길 트랙 id, "new"면 새 트랙 */
    readonly target: string;
    /** 지금 트랙으로 합칠 트랙들 */
    readonly merge: readonly string[];
    /** 높이 순 나누기에서 앞 트랙에 둘 음 */
    readonly order: "high" | "low";
  }

  /** 해 보면 어떻게 되는지 (창에 미리 보여 준다) */
  export interface VoicePreview {
    readonly moved: number;
    readonly blocked: number;
  }

  export const VOICE_STORAGE = "mmlce.voice";

  /** 지난번에 고른 방식·순서 (사람마다 쓰는 방식이 달라 기억해 둔다) */
  export function parseVoicePrefs(raw: string | null): { mode: VoiceMode; order: "high" | "low" } {
    let v: unknown;
    try {
      v = raw ? JSON.parse(raw) : undefined;
    } catch {
      v = undefined;
    }
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return {
      mode: o.mode === "move" || o.mode === "voice" ? o.mode : "merge",
      order: o.order === "low" ? "low" : "high",
    };
  }
</script>

<script lang="ts">
  import { t } from "./i18n.svelte";

  type Item = { readonly id: string; readonly label: string };

  interface Props {
    /** 고른 음 수 (0이면 옮기기를 못 고른다) */
    selected: number;
    /** 지금 트랙 이름 */
    current: string;
    /** 고른 음을 받을 수 있는 트랙 (지금 트랙 빼고 곡 전체) */
    targets: readonly Item[];
    /** 같은 악보의 다른 트랙 (합치기) */
    siblings: readonly Item[];
    initialMode: VoiceMode;
    initialOrder: "high" | "low";
    preview: (mode: VoiceMode, options: VoiceOptions) => VoicePreview;
    onapply: (mode: VoiceMode, options: VoiceOptions) => void;
    onclose: () => void;
  }

  let { selected, current, targets, siblings, initialMode, initialOrder, preview, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let mode = $state<VoiceMode>(initialMode === "move" && selected === 0 ? "merge" : initialMode);
  let target = $state("new");
  // svelte-ignore state_referenced_locally
  let merge = $state<string[]>(siblings.map((s) => s.id));
  // svelte-ignore state_referenced_locally
  let order = $state<"high" | "low">(initialOrder);

  const usable = $derived({ move: selected > 0, merge: siblings.length > 0, voice: siblings.length > 0 });
  const options = $derived<VoiceOptions>({ target, merge, order });
  const result = $derived(usable[mode] ? preview(mode, options) : { moved: 0, blocked: 0 });

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!usable[mode] || result.moved === 0) return;
    onapply(mode, options);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.voiceTitle")}</h2>
  <p class="muted">{t("ui.voiceIntro")}</p>

  <fieldset disabled={!usable.move}>
    <label class="mode"><input type="radio" name="mode" value="move" bind:group={mode} /> {t("ui.voiceMove", { count: selected })}</label>
    {#if mode === "move"}
      <div class="sub">
        <label>
          {t("ui.voiceTarget")}
          <select bind:value={target}>
            <option value="new">{t("ui.voiceNewTrack")}</option>
            {#each targets as tr (tr.id)}
              <option value={tr.id}>{tr.label}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
  </fieldset>

  <fieldset disabled={!usable.merge}>
    <label class="mode"><input type="radio" name="mode" value="merge" bind:group={mode} /> {t("ui.voiceMerge", { name: current })}</label>
    {#if mode === "merge"}
      <div class="sub">
        {#each siblings as tr (tr.id)}
          <label><input type="checkbox" value={tr.id} bind:group={merge} /> {tr.label}</label>
        {/each}
      </div>
    {/if}
  </fieldset>

  <fieldset disabled={!usable.voice}>
    <label class="mode"><input type="radio" name="mode" value="voice" bind:group={mode} /> {t("ui.voiceByPitch")}</label>
    {#if mode === "voice"}
      <div class="sub">
        <label><input type="radio" name="order" value="high" bind:group={order} /> {t("ui.voiceHighFirst")}</label>
        <label><input type="radio" name="order" value="low" bind:group={order} /> {t("ui.voiceLowFirst")}</label>
      </div>
    {/if}
  </fieldset>

  {#if usable[mode]}
    <p class="muted">{t("ui.voiceMoved", { count: result.moved })}</p>
    {#if result.blocked > 0}
      <p class="warn">{t("ui.voiceBlocked", { count: result.blocked })}</p>
    {/if}
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button disabled={!usable[mode] || result.moved === 0} onclick={apply}>{t("ui.apply")}</button>
  </footer>
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
  fieldset {
    border: 0;
    margin: 6px 0;
    padding: 0;
  }
  fieldset:disabled {
    opacity: 0.5;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 6px 0 4px 24px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0;
  }
  .warn {
    color: var(--danger);
    margin: 4px 0;
  }
</style>
