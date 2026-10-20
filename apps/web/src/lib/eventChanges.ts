/**
 * 템포·박자·마커 창에서 바뀐 것만 고른다. undefined = 그대로, null = 지우기, 값 = 넣거나 고치기.
 * 그 자리에 없는 템포·박자는 지금 흐르는 값(before의 bpm·박자, 곡 처음은 기본 t120)과 다를 때만 넣는다
 * (값을 그대로 두고 적용해도 같은 템포·박자를 하나 더 적지 않는다).
 * 세 가지를 한 번에 바꿔도 실행 취소 한 칸이 되도록 앱이 이 결과를 한 명령으로 묶는다
 */
export interface EventChanges {
  readonly tempo?: number | null;
  readonly meter?: { readonly beats: number; readonly unit: number } | null;
  readonly marker?: string | null;
}

export function eventChanges(
  before: {
    readonly tempo: { readonly bpm: number; readonly here: boolean };
    readonly meter: { readonly beats: number; readonly unit: number; readonly here: boolean };
    readonly marker: { readonly text: string; readonly here: boolean };
  },
  on: { readonly tempo: boolean; readonly meter: boolean; readonly marker: boolean },
  value: { readonly bpm: number; readonly beats: number; readonly unit: number; readonly text: string },
): EventChanges {
  const out: { tempo?: number | null; meter?: { beats: number; unit: number } | null; marker?: string | null } = {};
  if (on.tempo) {
    if (value.bpm !== before.tempo.bpm) out.tempo = value.bpm;
  } else if (before.tempo.here) out.tempo = null;
  if (on.meter) {
    if (value.beats !== before.meter.beats || value.unit !== before.meter.unit) out.meter = { beats: value.beats, unit: value.unit };
  } else if (before.meter.here) out.meter = null;
  const text = value.text.trim();
  if (on.marker) {
    if (!before.marker.here || text !== before.marker.text) out.marker = text;
  } else if (before.marker.here) out.marker = null;
  return out;
}
