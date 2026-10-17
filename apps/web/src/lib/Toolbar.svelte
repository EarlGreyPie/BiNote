<script lang="ts" module>
  /** 롤에 그릴 트랙: 고른 트랙만 / 고른 트랙의 악보 / 곡 전체 */
  export type RollLayer = "track" | "score" | "all";

  /** 카포 0~24 (파일에 적을 수 있는 범위와 같다) */
  const CAPOS = Array.from({ length: 25 }, (_, c) => c);

  /** 새 음 길이 이름 (타브 숫자판도 쓴다) */
  export function lengthLabel(l: NoteLength): string {
    if (l === "grid") return t("ui.noteLengthGrid");
    return ["12", "24", "48"].includes(l) ? t("ui.noteLengthTriplet", { n: l }) : `l${l}`;
  }
</script>

<script lang="ts">
  import { METER_UNITS } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { mediaAccept } from "./fileAccept";
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import VolumeBox from "./VolumeBox.svelte";
  import { GRID_DIVISIONS } from "./keymap";
  import { TUNINGS, type TuningName } from "./tunings";
  import { NOTE_LENGTHS, type NoteLength, type Orientation, type RollTool } from "./roll";

  /** 보기별 도구줄: 피아노롤이면 입력 도구·박자·격자·줌·마디·레이어, 타브면 튜닝·카포·격자 */
  interface Props {
    viewMode: "roll" | "tab";
    onview: (mode: "roll" | "tab") => void;
    /** 단축키 안내 (툴팁에 붙인다) */
    tabHint: string;
    tool: RollTool;
    /** 고르기 도구로 고른 음을 끌어 옮길 수 있는지 (자물쇠를 풀면 true) */
    selectMove: boolean;
    onselectmove: (on: boolean) => void;
    meter: { beats: number; unit: number };
    onmeter: (beats: number, unit: number) => void;
    division: number;
    /** 새 음 길이 */
    noteLength: NoteLength;
    inputVolume: number | undefined;
    volumeMin: number;
    volumeMax: number;
    selectedVolume: number | null | undefined;
    onselectedvolume: (vol: number) => void;
    hasCursor: boolean;
    onbar: (kind: "insert" | "delete") => void;
    onfit: () => void;
    onzoom: (axis: "time" | "pitch", factor: number) => void;
    layer: RollLayer;
    /** 좁은 화면(세로·1300px 이하): 도구줄을 한 줄로 쓰려고 일부를 ⋯ 메뉴로 넘긴다 */
    compact: boolean;
    tuningName: TuningName;
    capo: number;
    showEvents: boolean;
    orientation: Orientation;
    sideBySide: boolean;
    /** 나란히가 뜻이 있는지 (가로 화면 · 패널 옆일 때만) */
    canSide: boolean;
    loadingReference: boolean;
    onreference: (event: Event) => void;
    onvideo: (event: Event) => void;
    ontool: (tool: RollTool) => void;
    ondivision: (division: number) => void;
    onnotelength: (length: NoteLength) => void;
    onlayer: (layer: RollLayer) => void;
    ontuning: (name: TuningName) => void;
    oncapo: (capo: number) => void;
    ontoggleevents: () => void;
    ontoggleorientation: () => void;
    ontoggleside: () => void;
  }

  let {
    viewMode,
    onview,
    tabHint,
    tool,
    selectMove,
    onselectmove,
    meter,
    onmeter,
    division,
    noteLength,
    inputVolume = $bindable(),
    volumeMin,
    volumeMax,
    selectedVolume,
    onselectedvolume,
    hasCursor,
    onbar,
    onfit,
    onzoom,
    layer,
    compact,
    tuningName,
    capo,
    showEvents,
    orientation,
    sideBySide,
    canSide,
    loadingReference,
    onreference,
    onvideo,
    ontool,
    ondivision,
    onnotelength,
    onlayer,
    ontuning,
    oncapo,
    ontoggleevents,
    ontoggleorientation,
    ontoggleside,
  }: Props = $props();

  let referenceInput: HTMLInputElement;
  let videoInput: HTMLInputElement;

  const LAYERS: readonly RollLayer[] = ["track", "score", "all"];
  const layerLabel = (l: RollLayer) => t(l === "track" ? "ui.layerTrack" : l === "score" ? "ui.layerScore" : "ui.layerAll");

  const moreMenu: MenuItem[] = $derived([
    ...(viewMode === "roll"
      ? [
          { label: t("ui.events"), title: t("ui.eventsHelp"), checked: showEvents, run: ontoggleevents },
          { label: t("ui.verticalRoll"), title: t("ui.verticalRollHelp"), checked: orientation === "vertical", run: ontoggleorientation },
          { label: t("ui.sideBySide"), title: t("ui.sideBySideHelp"), checked: canSide && sideBySide, disabled: !canSide, run: ontoggleside },
          ...(compact
            ? [
                { separator: true } as const,
                ...LAYERS.map((l) => ({ label: `${t("ui.layer")}: ${layerLabel(l)}`, checked: layer === l, run: () => onlayer(l) })),
                { separator: true } as const,
                { label: t("ui.insertBar"), title: t("ui.barHelp"), disabled: !hasCursor, run: () => onbar("insert") },
                { label: t("ui.deleteBar"), title: t("ui.barHelp"), disabled: !hasCursor, run: () => onbar("delete") },
                { label: t("ui.zoomPitchIn"), run: () => onzoom("pitch", 1.25) },
                { label: t("ui.zoomPitchOut"), run: () => onzoom("pitch", 1 / 1.25) },
              ]
            : []),
          { separator: true } as const,
        ]
      : []),
    { label: loadingReference ? t("ui.referenceLoading") : t("ui.reference") + "…", title: t("ui.referenceHelp"), run: () => referenceInput.click() },
    ...(viewMode === "roll" ? [{ label: t("ui.video") + "…", run: () => videoInput.click() }] : []),
  ]);
</script>

<div class="toolbar" class:compact role="toolbar">
  <span class="seg">
    <button class:on={viewMode === "roll"} onclick={() => onview("roll")}>{t("ui.pianoRoll")}</button>
    <button class:on={viewMode === "tab"} title={t("ui.tabView") + tabHint} onclick={() => onview("tab")}>{t("ui.tabView")}</button>
  </span>
  <span class="sep"></span>

  {#if viewMode === "roll"}
    <button class="icon" class:on={tool === "pen"} title={t("ui.toolPenHelp")} aria-label={t("ui.toolPen")} aria-pressed={tool === "pen"} onclick={() => ontool("pen")}>
      <Icon name="pencil" />
    </button>
    <button class="icon" class:on={tool === "select"} title={t("ui.toolSelectHelp")} aria-label={t("ui.toolSelect")} aria-pressed={tool === "select"} onclick={() => ontool("select")}>
      <Icon name="pointer" />
    </button>
    {#if tool === "select"}
      <button
        class="icon lockbtn"
        class:on={selectMove}
        title={selectMove ? t("ui.selectMoveOnHelp") : t("ui.selectMoveOffHelp")}
        aria-label={t("ui.selectMove")}
        aria-pressed={selectMove}
        onclick={() => onselectmove(!selectMove)}
      >
        <Icon name={selectMove ? "lock-open" : "lock"} />
      </button>
    {/if}
    <button class="icon" class:on={tool === "eraser"} title={t("ui.eraserHelp")} aria-label={t("ui.eraser")} aria-pressed={tool === "eraser"} onclick={() => ontool("eraser")}>
      <Icon name="eraser" />
    </button>
    <button class="icon" class:on={tool === "split"} title={t("ui.toolSplitHelp")} aria-label={t("ui.toolSplit")} aria-pressed={tool === "split"} onclick={() => ontool("split")}>
      <Icon name="scissors" />
    </button>
    <span class="sep"></span>
    <span class="field" title={t("ui.meterHelp")}>
      <span class="muted">{t("ui.meter")}</span>
      <input class="num" type="number" min="1" max="32" value={meter.beats} onchange={(e) => onmeter(Number(e.currentTarget.value), meter.unit)} />
      /
      <select value={meter.unit} onchange={(e) => onmeter(meter.beats, Number(e.currentTarget.value))}>
        {#each METER_UNITS as u (u)}<option value={u}>{u}</option>{/each}
      </select>
    </span>
    <label class="field">
      <span class="muted">{t("ui.grid")}</span>
      <select value={division} onchange={(e) => ondivision(Number(e.currentTarget.value))}>
        {#each GRID_DIVISIONS as d (d)}<option value={d}>1/{d}</option>{/each}
      </select>
    </label>
    <label class="field" title={t("ui.noteLengthHelp")}>
      <span class="muted">{t("ui.noteLength")}</span>
      <select value={noteLength} onchange={(e) => onnotelength(e.currentTarget.value as NoteLength)}>
        {#each NOTE_LENGTHS as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
      </select>
    </label>
    <VolumeBox bind:value={inputVolume} min={volumeMin} max={volumeMax} selected={selectedVolume} onselected={onselectedvolume} />
    <span class="sep"></span>
    <span class="group" title={t("ui.zoomHelp")}>
      <button class="icon" title={t("ui.fitAllHelp")} aria-label={t("ui.fitAll")} onclick={onfit}><Icon name="maximize" /></button>
      <button class="icon" title={t("ui.zoomTimeOut")} aria-label={t("ui.zoomTimeOut")} onclick={() => onzoom("time", 1 / 1.25)}>
        <Icon name="arrows-h" size={14} /><Icon name="minus" size={12} />
      </button>
      <button class="icon" title={t("ui.zoomTimeIn")} aria-label={t("ui.zoomTimeIn")} onclick={() => onzoom("time", 1.25)}>
        <Icon name="arrows-h" size={14} /><Icon name="plus" size={12} />
      </button>
      {#if !compact}
        <button class="icon" title={t("ui.zoomPitchOut")} aria-label={t("ui.zoomPitchOut")} onclick={() => onzoom("pitch", 1 / 1.25)}>
          <Icon name="arrows-v" size={14} /><Icon name="minus" size={12} />
        </button>
        <button class="icon" title={t("ui.zoomPitchIn")} aria-label={t("ui.zoomPitchIn")} onclick={() => onzoom("pitch", 1.25)}>
          <Icon name="arrows-v" size={14} /><Icon name="plus" size={12} />
        </button>
      {/if}
    </span>
    {#if !compact}
      <span class="sep"></span>
      <span class="group">
        <button class="icon" disabled={!hasCursor} title={t("ui.barHelp")} aria-label={t("ui.insertBar")} onclick={() => onbar("insert")}>
          <Icon name="plus" size={14} />{t("ui.insertBar")}
        </button>
        <button class="icon" disabled={!hasCursor} title={t("ui.barHelp")} aria-label={t("ui.deleteBar")} onclick={() => onbar("delete")}>
          <Icon name="minus" size={14} />{t("ui.deleteBar")}
        </button>
      </span>
    {/if}
    <span class="spacer"></span>
    {#if !compact}
      <span class="field" title={t("ui.layerHelp")}>
        <span class="muted">{t("ui.layer")}</span>
        <span class="seg">
          {#each LAYERS as l (l)}
            <button class:on={layer === l} onclick={() => onlayer(l)}>{layerLabel(l)}</button>
          {/each}
        </span>
      </span>
    {/if}
  {:else}
    <label class="field" title={t("ui.tuningHelp")}>
      <span class="muted">{t("ui.tuning")}</span>
      <select value={tuningName} onchange={(e) => ontuning(e.currentTarget.value as TuningName)}>
        {#each Object.entries(TUNINGS) as [name, info] (name)}<option value={name}>{t(info.key)}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="muted">{t("ui.capo")}</span>
      <select value={capo} onchange={(e) => oncapo(Number(e.currentTarget.value))}>
        {#each CAPOS as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="muted">{t("ui.grid")}</span>
      <select value={division} onchange={(e) => ondivision(Number(e.currentTarget.value))}>
        {#each GRID_DIVISIONS as d (d)}<option value={d}>1/{d}</option>{/each}
      </select>
    </label>
    <label class="field" title={t("ui.noteLengthHelp")}>
      <span class="muted">{t("ui.noteLength")}</span>
      <select value={noteLength} onchange={(e) => onnotelength(e.currentTarget.value as NoteLength)}>
        {#each NOTE_LENGTHS as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
      </select>
    </label>
    <VolumeBox bind:value={inputVolume} min={volumeMin} max={volumeMax} selected={undefined} />
    <span class="spacer"></span>
  {/if}
  <Menu icon="ellipsis" title={t("ui.more")} align="right" items={moreMenu} />
  <input type="file" accept={mediaAccept("audio/*,video/*")} onchange={onreference} hidden bind:this={referenceInput} />
  <input type="file" accept={mediaAccept("video/*")} onchange={onvideo} hidden bind:this={videoInput} />
</div>
