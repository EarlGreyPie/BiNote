<script lang="ts" module>
  /** 롤에 그릴 트랙: 고른 트랙만 / 고른 트랙의 악보 / 곡 전체 */
  export type RollLayer = "track" | "score" | "all";

  /** 카포 0~24 (파일에 적을 수 있는 범위와 같다) */
  const CAPOS = Array.from({ length: 25 }, (_, c) => c);

  /** 새 음 길이 이름 (타브 숫자판도 쓴다) */
  export function lengthLabel(l: LengthName): string {
    if (l === "grid") return t("ui.noteLengthGrid");
    if (["3", "6", "12", "24", "48"].includes(l)) return t("ui.noteLengthTriplet", { n: l });
    // 2의 거듭제곱이 아닌 길이 숫자는 잇단음. 정해 둔 잇단음이면 몇 분 몇 잇단인지 붙인다
    const p = lengthNumber(l);
    if (p === undefined || (p.length & (p.length - 1)) === 0) return `l${l}`;
    const tp = tupletPrefs.tuplet;
    return tupletName(tp) === l ? t("ui.noteLengthTuplet", { n: l, base: tupletBaseLabel(tp.base, tp.dotted), count: tp.count }) : t("ui.noteLengthTupletPlain", { n: l });
  }

  /** 잇단음 바탕 음표 이름 ("4분", "점4분") */
  export function tupletBaseLabel(base: number, dotted: boolean): string {
    if (base === 1) return t(dotted ? "ui.tupletBaseWholeDotted" : "ui.tupletBaseWhole");
    return t(dotted ? "ui.tupletBaseDotted" : "ui.tupletBaseName", { n: base });
  }
</script>

<script lang="ts">
  import { METER_UNITS } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { mediaAccept } from "./fileAccept";
  import Icon from "./Icon.svelte";
  import { buttonNamesOn, labs } from "./labs.svelte";
  import { buttonName } from "./buttonName";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import VolumeBox from "./VolumeBox.svelte";
  import { lengthNumber, tupletName, TUPLET_PICK } from "./tuplet";
  import { tupletPrefs } from "./tupletPrefs.svelte";
  import { TUNINGS, type TuningName } from "./tunings";
  import { type LengthName, type NoteLength, type Orientation, type RollTool } from "./roll";
  import { coarsePointer } from "./mmlPad.svelte";
  import { nextTabAlign, TAB_ALIGN_ICON, TAB_ALIGN_LABEL, type TabAlign } from "./tabAlign";

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
    /** 고를 수 있는 격자 (목록 칸 + 잇단음 칸) */
    divisions: readonly number[];
    /** 새 음 → 잇단음…: 잇단음 정하기 창을 연다 */
    ontuplet: () => void;
    /** 새 음 길이 */
    noteLength: NoteLength;
    /** 고를 수 있는 새 음 길이 (게임 한도로 거른 목록, lengthsFor) */
    noteLengths: readonly NoteLength[];
    inputVolume: number | undefined;
    volumeMin: number;
    volumeMax: number;
    selectedVolume: number | null | undefined;
    onselectedvolume: (vol: number) => void;
    hasCursor: boolean;
    onbar: (kind: "insert" | "delete") => void;
    /** 전체 보기 (피아노롤·타브 모두. 앱이 보기에 맞게 부른다) */
    onfit: () => void;
    /** 확대·축소 (타브는 시간만) */
    onzoom: (axis: "time" | "pitch", factor: number) => void;
    /** 타브 지판 위치와 바꾸기, 타브 크기 한 단계 (PC에서만 위 도구줄에 둔다. 터치는 타브 아래 도구 띠) */
    tabAlign: TabAlign;
    ontabalign: () => void;
    ontabsize: (step: 1 | -1) => void;
    layer: RollLayer;
    /** 좁은 화면(세로·1700px 이하): 도구줄을 한 줄로 쓰려고 일부를 ⋯ 메뉴로 넘긴다 */
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
    /** 타브 그대로 튜닝 바꾸기 창 열기. 없으면 단추를 숨긴다 (고른 트랙이 없을 때) */
    onretune?: (() => void) | undefined;
    ontoggleevents: () => void;
    ontoggleorientation: () => void;
    /** 트랙 패널 자리: 옆(가로) / 아래(세로). 세로 화면에서는 늘 아래라 단추를 숨긴다 */
    dock: "right" | "bottom";
    canDock: boolean;
    ondock: (dock: "right" | "bottom") => void;
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
    divisions,
    ontuplet,
    noteLength,
    noteLengths,
    inputVolume = $bindable(),
    volumeMin,
    volumeMax,
    selectedVolume,
    onselectedvolume,
    hasCursor,
    onbar,
    onfit,
    onzoom,
    tabAlign,
    ontabalign,
    ontabsize,
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
    onretune,
    ontoggleevents,
    ontoggleorientation,
    dock,
    canDock,
    ondock,
    ontoggleside,
  }: Props = $props();

  /** 새 음 길이 고르기. 잇단음…이면 창을 열고 고르기 칸은 지금 길이로 되돌린다 */
  function pickLength(e: Event & { currentTarget: HTMLSelectElement }) {
    const value = e.currentTarget.value;
    if (value !== TUPLET_PICK) return onnotelength(value as NoteLength);
    e.currentTarget.value = noteLength;
    ontuplet();
  }

  let referenceInput: HTMLInputElement;
  let videoInput: HTMLInputElement;

  const LAYERS: readonly RollLayer[] = ["track", "score", "all"];
  const layerLabel = (l: RollLayer) => t(l === "track" ? "ui.layerTrack" : l === "score" ? "ui.layerScore" : "ui.layerAll");

  /** 실험실: 아이콘 단추에 올리면 이름표 */
  const names = $derived(buttonNamesOn());
  const alignText = $derived(t("ui.tabAlign", { now: t(TAB_ALIGN_LABEL[tabAlign]), next: t(TAB_ALIGN_LABEL[nextTabAlign(tabAlign)]) }));

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
    // PC 타브: 좁은 도구줄에서는 덜 쓰는 타브 크기·지판 위치를 메뉴로 (가로 −/+와 전체 보기는 도구줄에 남는다)
    ...(viewMode === "tab" && compact && !coarsePointer
      ? [
          { label: t("ui.tabSmaller"), run: () => ontabsize(-1) },
          { label: t("ui.tabBigger"), run: () => ontabsize(1) },
          { label: alignText, run: ontabalign },
          { separator: true } as const,
        ]
      : []),
    { label: loadingReference ? t("ui.referenceLoading") : t("ui.reference") + "…", title: t("ui.referenceHelp"), run: () => referenceInput.click() },
    ...(viewMode === "roll" ? [{ label: t("ui.video") + "…", run: () => videoInput.click() }] : []),
  ]);
</script>

{#snippet dockSwitch()}
  {#if canDock}
    <span class="seg dock" role="group" title={t("ui.dockSwitchHelp")} aria-label={t("ui.dockSwitch")}>
      <button class:on={dock === "right"} aria-pressed={dock === "right"} title={t("ui.dockSideHelp")} onclick={() => ondock("right")}>
        <Icon name="panel-right" size={14} />{t("ui.dockSide")}
      </button>
      <button class:on={dock === "bottom"} aria-pressed={dock === "bottom"} title={t("ui.dockStackHelp")} onclick={() => ondock("bottom")}>
        <Icon name="panel-bottom" size={14} />{t("ui.dockStack")}
      </button>
    </span>
  {/if}
{/snippet}

{#snippet meterField()}
  <!-- 박자 칸: 피아노롤은 재생 커서, 타브는 타브 커서가 든 마디부터 바꾼다 -->
  <span class="field" title={t("ui.meterHelp")}>
    <span class="muted">{t("ui.meter")}</span>
    <input class="num" type="number" min="1" max="32" value={meter.beats} onchange={(e) => onmeter(Number(e.currentTarget.value), meter.unit)} />
    /
    <select value={meter.unit} onchange={(e) => onmeter(meter.beats, Number(e.currentTarget.value))}>
      {#each METER_UNITS as u (u)}<option value={u}>{u}</option>{/each}
    </select>
  </span>
{/snippet}

<div class="toolbar" class:compact role="toolbar">
  <span class="seg">
    <button class:on={viewMode === "roll"} onclick={() => onview("roll")}>{t("ui.pianoRoll")}</button>
    <button class:on={viewMode === "tab"} title={t("ui.tabView") + tabHint} onclick={() => onview("tab")}>{t("ui.tabView")}</button>
  </span>
  <span class="sep"></span>

  {#if viewMode === "roll"}
    <button class="icon" class:on={tool === "pen"} title={names ? undefined : t("ui.toolPenHelp")} aria-label={t("ui.toolPen")} use:buttonName={{ on: names, name: t("ui.toolPen") }} aria-pressed={tool === "pen"} onclick={() => ontool("pen")}>
      <Icon name="pencil" />
    </button>
    <button class="icon" class:on={tool === "select"} title={names ? undefined : t("ui.toolSelectHelp")} aria-label={t("ui.toolSelect")} use:buttonName={{ on: names, name: t("ui.toolSelect") }} aria-pressed={tool === "select"} onclick={() => ontool("select")}>
      <Icon name="pointer" />
    </button>
    {#if tool === "select"}
      <button
        class="icon lockbtn"
        class:on={selectMove}
        title={names ? undefined : selectMove ? t("ui.selectMoveOnHelp") : t("ui.selectMoveOffHelp")}
        aria-label={t("ui.selectMove")} use:buttonName={{ on: names, name: t("ui.selectMove") }}
        aria-pressed={selectMove}
        onclick={() => onselectmove(!selectMove)}
      >
        <Icon name={selectMove ? "lock-open" : "lock"} />
      </button>
    {/if}
    <button class="icon" class:on={tool === "eraser"} title={names ? undefined : t("ui.eraserHelp")} aria-label={t("ui.eraser")} use:buttonName={{ on: names, name: t("ui.eraser") }} aria-pressed={tool === "eraser"} onclick={() => ontool("eraser")}>
      <Icon name="eraser" />
    </button>
    <button class="icon" class:on={tool === "split"} title={names ? undefined : t("ui.toolSplitHelp")} aria-label={t("ui.toolSplit")} use:buttonName={{ on: names, name: t("ui.toolSplit") }} aria-pressed={tool === "split"} onclick={() => ontool("split")}>
      <Icon name="scissors" />
    </button>
    {#if labs.on}
      <button class="icon" class:on={tool === "reverb"} title={names ? undefined : t("ui.toolReverbHelp")} aria-label={t("ui.toolReverb")} use:buttonName={{ on: names, name: t("ui.toolReverb") }} aria-pressed={tool === "reverb"} onclick={() => ontool("reverb")}>
        <Icon name="reverb" />
      </button>
    {/if}
    <span class="sep"></span>
    {@render meterField()}
    <label class="field">
      <span class="muted">{t("ui.grid")}</span>
      <select value={division} onchange={(e) => ondivision(Number(e.currentTarget.value))}>
        {#each divisions as d (d)}<option value={d}>1/{d}</option>{/each}
      </select>
    </label>
    <label class="field" title={t("ui.noteLengthHelp")}>
      <span class="muted">{t("ui.noteLength")}</span>
      <select value={noteLength} onchange={pickLength}>
        {#each noteLengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
        <option value={TUPLET_PICK}>{t("ui.noteLengthTupletPick")}</option>
      </select>
    </label>
    <VolumeBox bind:value={inputVolume} min={volumeMin} max={volumeMax} selected={selectedVolume} onselected={onselectedvolume} />
    <span class="sep"></span>
    <span class="group" title={t("ui.zoomHelp")}>
      <button class="icon" title={names ? undefined : t("ui.fitAllHelp")} aria-label={t("ui.fitAll")} use:buttonName={{ on: names, name: t("ui.fitAll") }} onclick={onfit}><Icon name="maximize" /></button>
      <button class="icon" title={names ? undefined : t("ui.zoomTimeOut")} aria-label={t("ui.zoomTimeOut")} use:buttonName={{ on: names, name: t("ui.zoomOutTime") }} onclick={() => onzoom("time", 1 / 1.25)}>
        <Icon name="arrows-h" size={14} /><Icon name="minus" size={12} />
      </button>
      <button class="icon" title={names ? undefined : t("ui.zoomTimeIn")} aria-label={t("ui.zoomTimeIn")} use:buttonName={{ on: names, name: t("ui.zoomInTime") }} onclick={() => onzoom("time", 1.25)}>
        <Icon name="arrows-h" size={14} /><Icon name="plus" size={12} />
      </button>
      {#if !compact}
        <button class="icon" title={names ? undefined : t("ui.zoomPitchOut")} aria-label={t("ui.zoomPitchOut")} use:buttonName={{ on: names, name: t("ui.keysSmaller") }} onclick={() => onzoom("pitch", 1 / 1.25)}>
          <Icon name="arrows-v" size={14} /><Icon name="minus" size={12} />
        </button>
        <button class="icon" title={names ? undefined : t("ui.zoomPitchIn")} aria-label={t("ui.zoomPitchIn")} use:buttonName={{ on: names, name: t("ui.keysBigger") }} onclick={() => onzoom("pitch", 1.25)}>
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
    {@render dockSwitch()}
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
      <select class="tuning" value={tuningName} onchange={(e) => ontuning(e.currentTarget.value as TuningName)}>
        {#each Object.entries(TUNINGS) as [name, info] (name)}<option value={name}>{t(info.key)}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="muted">{t("ui.capo")}</span>
      <select value={capo} onchange={(e) => oncapo(Number(e.currentTarget.value))}>
        {#each CAPOS as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </label>
    {#if onretune}
      <button title={t("ui.retuneHelp")} onclick={onretune}>{t("ui.retune")}…</button>
    {/if}
    {@render meterField()}
    <label class="field">
      <span class="muted">{t("ui.grid")}</span>
      <select value={division} onchange={(e) => ondivision(Number(e.currentTarget.value))}>
        {#each divisions as d (d)}<option value={d}>1/{d}</option>{/each}
      </select>
    </label>
    <label class="field" title={t("ui.noteLengthHelp")}>
      <span class="muted">{t("ui.noteLength")}</span>
      <select value={noteLength} onchange={pickLength}>
        {#each noteLengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
        <option value={TUPLET_PICK}>{t("ui.noteLengthTupletPick")}</option>
      </select>
    </label>
    <VolumeBox bind:value={inputVolume} min={volumeMin} max={volumeMax} selected={undefined} />
    {#if !coarsePointer}
      <!-- PC: 피아노롤처럼 확대 묶음을 위 도구줄에 (터치는 타브 아래 도구 띠에 그대로) -->
      <span class="sep"></span>
      <span class="group">
        <button class="icon" title={names ? undefined : t("ui.tabFitAllHelp")} aria-label={t("ui.fitAll")} use:buttonName={{ on: names, name: t("ui.fitAll") }} onclick={onfit}><Icon name="maximize" /></button>
        <button class="icon" title={names ? undefined : t("ui.zoomOutTime")} aria-label={t("ui.zoomOutTime")} use:buttonName={{ on: names, name: t("ui.zoomOutTime") }} onclick={() => onzoom("time", 1 / 1.25)}>
          <Icon name="arrows-h" size={14} /><Icon name="minus" size={12} />
        </button>
        <button class="icon" title={names ? undefined : t("ui.zoomInTime")} aria-label={t("ui.zoomInTime")} use:buttonName={{ on: names, name: t("ui.zoomInTime") }} onclick={() => onzoom("time", 1.25)}>
          <Icon name="arrows-h" size={14} /><Icon name="plus" size={12} />
        </button>
        {#if !compact}
          <button class="icon" title={names ? undefined : t("ui.tabSmaller")} aria-label={t("ui.tabSmaller")} use:buttonName={{ on: names, name: t("ui.tabSmaller") }} onclick={() => ontabsize(-1)}>A−</button>
          <button class="icon" title={names ? undefined : t("ui.tabBigger")} aria-label={t("ui.tabBigger")} use:buttonName={{ on: names, name: t("ui.tabBigger") }} onclick={() => ontabsize(1)}>A+</button>
          <button class="icon" title={names ? undefined : alignText} aria-label={alignText} use:buttonName={{ on: names, name: alignText }} onclick={ontabalign}>{TAB_ALIGN_ICON[tabAlign]}</button>
        {/if}
      </span>
    {/if}
    <span class="spacer"></span>
    {@render dockSwitch()}
  {/if}
  <Menu icon="ellipsis" title={t("ui.more")} align="right" items={moreMenu} />
  <input type="file" accept={mediaAccept("audio/*,video/*")} onchange={onreference} hidden bind:this={referenceInput} />
  <input type="file" accept={mediaAccept("video/*")} onchange={onvideo} hidden bind:this={videoInput} />
</div>
