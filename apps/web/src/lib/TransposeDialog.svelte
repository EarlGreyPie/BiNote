<script lang="ts" module>
  /** 음정 변환 범위: 고른 음 / 고른 트랙 / 고른 트랙의 악보 / 곡 전체 */
  export type TransposeScope = "selection" | "track" | "score" | "song";

  /** 옮겨 보면 어떻게 되는지 (창에 미리 보여 준다) */
  export interface TransposeCheck {
    /** 옮길 음 수 */
    readonly count: number;
    /** MIDI 범위(0~127)를 넘어 옮길 수 없음 */
    readonly invalid: boolean;
    /** 악기 소리 범위 밖으로 나가 게임에서 옥타브째 접혀 날 음 수 */
    readonly folded: number;
  }
</script>

<script lang="ts">
  import { t } from "./i18n.svelte";

  interface Props {
    /** 고를 수 있는 범위와 이름 */
    scopes: readonly { readonly id: TransposeScope; readonly label: string }[];
    initialScope: TransposeScope;
    check: (scope: TransposeScope, semitones: number) => TransposeCheck;
    onapply: (scope: TransposeScope, semitones: number) => void;
    onclose: () => void;
  }

  let { scopes, initialScope, check, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let scope = $state<TransposeScope>(initialScope);
  let semitones = $state(0);
  const result = $derived(check(scope, semitones));

  $effect(() => {
    dialog.showModal();
  });

  function nudge(by: number) {
    semitones = Math.max(-48, Math.min(48, semitones + by));
  }

  function apply() {
    if (semitones === 0 || result.invalid || result.count === 0) return;
    onapply(scope, semitones);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.transpose")}</h2>
  <div class="row">
    {#each scopes as s (s.id)}
      <label><input type="radio" name="scope" value={s.id} bind:group={scope} /> {s.label}</label>
    {/each}
  </div>
  <div class="row">
    <button onclick={() => nudge(-12)}>{t("ui.octaveDown")}</button>
    <button onclick={() => nudge(-1)}>−1</button>
    <label>
      <input
        type="number"
        min="-48"
        max="48"
        value={semitones}
        oninput={(e) => {
          const v = Math.round(Number(e.currentTarget.value));
          if (Number.isFinite(v)) semitones = Math.max(-48, Math.min(48, v));
        }}
      />
      {t("ui.semitones")}
    </label>
    <button onclick={() => nudge(1)}>+1</button>
    <button onclick={() => nudge(12)}>{t("ui.octaveUp")}</button>
  </div>
  <p class="muted">{t("ui.transposeCount", { count: result.count })}</p>
  {#if result.invalid}
    <p class="warn">{t("ui.transposeInvalid")}</p>
  {:else if result.folded > 0}
    <p class="warn">{t("ui.transposeFolded", { count: result.folded })}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button disabled={semitones === 0 || result.invalid || result.count === 0} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
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
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  input[type="number"] {
    width: 4.5em;
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
