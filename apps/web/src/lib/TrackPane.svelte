<script lang="ts">
  import type { Song, Track } from "@mmlce/core";
  import type { Diagnostic } from "@mmlce/mml";
  import type { Snippet } from "svelte";
  import { t } from "./i18n.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import MmlKeyPad from "./MmlKeyPad.svelte";
  import StructureList from "./StructureList.svelte";
  import TrackEditor from "./TrackEditor.svelte";
  import TrackStrip from "./TrackStrip.svelte";
  import { EDITOR_SLOT_MIN_EM } from "./paneSplit";
  import { mmlPad } from "./mmlPad.svelte";
  import type { ScoreGroup } from "./scores";
  import type { TrackActions } from "./trackActions";

  /**
   * 트랙 패널. 옆 배치: 머리 · 구조 목록 · 편집기들. 아래 배치: 트랙 띠 · 편집기들 (편집기 수는 보기 메뉴).
   * 세로 화면에서는 머리의 [구조 | MML]로 목록과 편집기 중 하나만 보인다. MML 쪽에서는 편집기 위에 트랙 띠를 둬서
   * 구조로 돌아가지 않고도 트랙을 바꿀 수 있다.
   */
  interface Props {
    song: Song;
    groups: readonly ScoreGroup[];
    /** 트랙 → 글·검사 */
    tracks: readonly { track: Track; text: string; diagnostics: readonly Diagnostic[] }[];
    colors: ReadonlyMap<string, string>;
    activeTrackId: string | undefined;
    fileName: string;
    charLimit: number;
    dock: "right" | "bottom";
    portrait: boolean;
    trackInstrument: (track: Track) => string;
    /** 트랙의 지금 악기 글 (.2·.3 팩 번호 포함) */
    trackInstrumentLabel: (track: Track) => string;
    /** 트랙에서 고른 사운드팩 파일 이름 (없으면 자동) */
    trackPack: (track: Track) => string | undefined;
    /** 지금 올린 사운드팩 파일 이름들 */
    packLabels: readonly string[];
    actions: TrackActions;
    reveal: { trackId: string; from: number; to: number; focus: boolean; nonce: number } | undefined;
    /** 재생 중 지금 울리는 음의 글 자리 (고른 트랙) */
    playing?: readonly [number, number] | undefined;
    follow?: boolean;
    moreItems: readonly MenuItem[];
    onedit: (trackId: string, text: string) => void;
    onundo: () => void;
    onredo: () => void;
    ongodiag: (trackId: string, from: number, to: number) => void;
    /** 편집기 여러 개: 아래 편집기들에 연 트랙 (칸 순서대로, 비면 편집기 하나) */
    extraTrackIds?: readonly string[];
    /** 아래 편집기 트랙의 지금 울리는 음 글 자리 */
    playingOf?: (trackId: string) => readonly [number, number] | undefined;
    /** 아래 편집기 index번째 칸 닫기 */
    oncloseextra?: (index: number) => void;
    /** 머리 위에 끼우는 것 (악보책 나누기 결과 등) */
    top?: Snippet | undefined;
    /** 잠시 모든 편집기 글을 고칠 수 없게 (영상 속도를 직접 재는 동안) */
    hold?: boolean;
  }

  let { song, groups, tracks, colors, activeTrackId, fileName, charLimit, dock, portrait, trackInstrument, trackInstrumentLabel, trackPack, packLabels, actions, reveal, playing, follow = false, moreItems, onedit, onundo, onredo, ongodiag, extraTrackIds = [], playingOf, oncloseextra, top, hold = false }: Props = $props();

  let portraitView = $state<"structure" | "mml">("structure");
  // 세로 화면에서 롤의 음을 두 번 눌러(또는 검사로) 글 자리로 가라고 하면 편집기 쪽을 보여 준다
  $effect(() => {
    if (portrait && reveal?.focus) portraitView = "mml";
  });
  const chars = $derived(new Map(tracks.map((a) => [a.track.id, a.text.length])));
  const checks = $derived(new Map(tracks.map((a) => [a.track.id, a.diagnostics.length])));
  const active = $derived(tracks.find((a) => a.track.id === activeTrackId));
  /** 악보 안에서 몇 번째 트랙인지 (1부터) */
  function indexOf(id: string | undefined): number {
    const g = groups.find((x) => id !== undefined && x.trackIds.includes(id));
    return (g?.trackIds.indexOf(id!) ?? 0) + 1;
  }
  const activeIndex = $derived(indexOf(activeTrackId));
  const extras = $derived(extraTrackIds.map((id) => tracks.find((a) => a.track.id === id)).filter((a) => a !== undefined));
  const showStructure = $derived(!portrait || portraitView === "structure");
  const showEditor = $derived(!portrait || portraitView === "mml");
</script>

<div class="track-pane" class:bottom={dock === "bottom" && !portrait}>
  {@render top?.()}
  {#if dock === "bottom" && !portrait}
    <TrackStrip {song} {groups} {chars} {colors} {activeTrackId} {charLimit} {trackInstrument} {actions} />
  {:else}
    <div class="pane-head">
      {#if portrait}
        <span class="seg">
          <button class:on={portraitView === "structure"} onclick={() => (portraitView = "structure")}>{t("ui.paneStructure")}</button>
          <button class:on={portraitView === "mml"} onclick={() => (portraitView = "mml")}>{t("ui.paneMml")}</button>
        </span>
      {/if}
      <strong class="file" title={fileName}>{fileName || t("ui.tracks")}</strong>
      <span class="muted">{t("ui.paneCounts", { scores: groups.length, tracks: song.tracks.length })}</span>
      <span class="spacer"></span>
      <Menu icon="ellipsis" title={t("ui.more")} align="right" items={moreItems} />
    </div>
    {#if showStructure}
      <div class="structure" class:full={portrait}>
        <StructureList {song} {groups} {chars} {checks} {colors} {activeTrackId} {charLimit} {trackInstrument} {actions} />
      </div>
    {:else if portrait}
      <TrackStrip {song} {groups} {chars} {colors} {activeTrackId} {charLimit} {trackInstrument} {actions} />
    {/if}
  {/if}
  {#if showEditor || (dock === "bottom" && !portrait)}
    {#if active}
      <!-- 편집기 여러 개: 위(고른 트랙)와 아래 칸들이 높이를 똑같이 나눈다. 칸이 너무 낮아지면 최소 높이를 두고 이 칸 안에서 굴린다 -->
      <div class="editors" class:multi={extras.length > 0} style:--slot-min="{EDITOR_SLOT_MIN_EM}em">
        <div class="slot">
          <TrackEditor
            track={active.track}
            index={activeIndex}
            text={active.text}
            diagnostics={active.diagnostics}
            color={colors.get(active.track.id) ?? active.track.color}
            instrument={trackInstrument(active.track)}
            instrumentLabel={trackInstrumentLabel(active.track)}
            pack={trackPack(active.track)}
            {packLabels}
            {charLimit}
            showListen={dock === "bottom" && !portrait}
            reveal={reveal?.trackId === active.track.id ? reveal : undefined}
            {playing}
            {follow}
            oninstrument={(canonical) => actions.trackInstrument(active.track.id, canonical)}
            onpack={(pack) => actions.trackPack(active.track.id, pack)}
            onlisten={(change) => actions.listen(active.track.id, change)}
            {onedit}
            {onundo}
            {onredo}
            ongodiag={(from, to) => ongodiag(active.track.id, from, to)}
            onrename={(name) => actions.renameTrack(active.track.id, name)}
            locked={actions.viewOf(active.track.id).locked === true}
            onlock={(on) => actions.view(active.track.id, { locked: on })}
            {hold}
          />
        </div>
        {#each extras as extra, i (extra.track.id)}
          <div class="slot extra">
            <TrackEditor
              track={extra.track}
              index={indexOf(extra.track.id)}
              text={extra.text}
              diagnostics={extra.diagnostics}
              color={colors.get(extra.track.id) ?? extra.track.color}
              instrument={trackInstrument(extra.track)}
              instrumentLabel={trackInstrumentLabel(extra.track)}
              pack={trackPack(extra.track)}
              {packLabels}
              {charLimit}
              showListen={true}
              reveal={reveal?.trackId === extra.track.id ? reveal : undefined}
              playing={playingOf?.(extra.track.id)}
              {follow}
              oninstrument={(canonical) => actions.trackInstrument(extra.track.id, canonical)}
              onpack={(pack) => actions.trackPack(extra.track.id, pack)}
              onlisten={(change) => actions.listen(extra.track.id, change)}
              {onedit}
              {onundo}
              {onredo}
              ongodiag={(from, to) => ongodiag(extra.track.id, from, to)}
              onrename={(name) => actions.renameTrack(extra.track.id, name)}
              locked={actions.viewOf(extra.track.id).locked === true}
              onlock={(on) => actions.view(extra.track.id, { locked: on })}
              {hold}
              onclose={() => oncloseextra?.(i)}
            />
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted none">{t("ui.noTrackSelected")}</p>
    {/if}
  {/if}
  {#if mmlPad.enabled}<MmlKeyPad />{/if}
</div>

<style>
  /* 편집기들: 남는 높이를 쓰고, 칸이 최소 높이보다 낮아지면 이 안에서 세로로 굴린다 */
  .editors {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
  }
  /* 칸마다 높이를 똑같이 나눈다 */
  .slot {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
  }
  /* 여럿이면 칸마다 머리 줄 + 글 세 줄쯤은 보이게 (세로 화면 분할선 한도와 같은 기준: paneSplit.ts) */
  .editors.multi .slot {
    min-height: var(--slot-min, 8.5em);
  }
  .slot.extra {
    border-top: 2px solid var(--line);
  }
  .track-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    /* 글은 골라서 복사할 수 있게 */
    user-select: text;
    -webkit-user-select: text;
  }
  .pane-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 36px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .file {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .structure {
    flex: none;
    max-height: 45%;
    overflow: auto;
    border-bottom: 1px solid var(--line);
  }
  .structure.full {
    flex: 1 1 0;
    max-height: none;
    min-height: 0;
    border-bottom: none;
  }
  .none {
    padding: 8px 12px;
  }
</style>
