/**
 * 파일 고르기 창의 형식 거르기(accept).
 * iOS·iPadOS는 확장자를 자기가 아는 형식(UTI)으로 바꿔 거르기 때문에, .dls·.mml·.mmi처럼 모르는 확장자는
 * 회색으로 막혀 고를 수 없다. 안드로이드 크롬은 거르기가 있으면(.mid → audio/midi처럼) 고르기 창을
 * "녹음·파일"로 좁혀 구글 드라이브 같은 앱이 빠진다. 그래서 이 기기들에서는 거르지 않고, 고른 다음에 확인한다.
 */
const UA = typeof navigator === "undefined" ? "" : navigator.userAgent;
const ANDROID = /Android/.test(UA);
const IOS =
  /iPad|iPhone|iPod/.test(UA) ||
  (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const UNFILTERED = ANDROID || IOS;

/** 파일 고르기 창을 띄우는 기기 종류. 거르기 방법이 기기마다 다르다. */
export type PickerDevice = "ios" | "android" | "other";
const DEVICE: PickerDevice = IOS ? "ios" : ANDROID ? "android" : "other";

/**
 * iOS·iPadOS에서 쓰는 거르기 값. "모든 데이터 파일"(public.data)로 바뀌어 어떤 확장자도 막지 않으면서,
 * 사진·영상 형식이 아니므로 "사진 보관함"·"사진 또는 비디오 찍기" 메뉴 없이 파일 앱이 바로 열린다.
 * 거르기를 아예 비우면 iOS는 사진·카메라 항목을 함께 보여 준다.
 */
export const IOS_ANY_FILE = "application/octet-stream";

/**
 * 악보·사운드팩처럼 사진이 아닌 파일을 고르는 창의 거르기.
 * 안드로이드는 거르지 않는다(거르면 고르기 창이 좁아진다). 고른 다음에 확장자로 확인한다.
 */
export function fileAccept(list: string, device: PickerDevice = DEVICE): string | undefined {
  if (device === "ios") return IOS_ANY_FILE;
  if (device === "android") return undefined;
  return list;
}

/**
 * 열기 창(showOpenFilePicker)에 넘길 형식 거르기.
 * 안드로이드 크롬(132판부터 열기 창이 있음)은 확장자를 보지 않고 형식 이름(MIME)으로만 거른다.
 * 그래서 "application/octet-stream"으로 거르면 audio/midi로 알려진 .mid가 회색으로 막혀 고를 수 없었다.
 * 거르지 않는 기기에서는 형식을 넘기지 않고(모든 파일), 고른 다음에 확장자로 확인한다.
 */
export function openPickerTypes(
  description: string,
  extensions: readonly string[],
  unfiltered = UNFILTERED,
): { description: string; accept: Record<string, string[]> }[] | undefined {
  return unfiltered ? undefined : [{ description, accept: { "application/octet-stream": [...extensions] } }];
}

/** 소리·영상(audio/*·video/*) 거르기. iOS는 이 형식은 잘 거르므로 안드로이드에서만 뺀다. */
export function mediaAccept(list: string): string | undefined {
  return ANDROID ? undefined : list;
}

/** 파일 이름이 목록(".dls,.sf2")의 확장자 가운데 하나인지 */
export function hasExtension(name: string, list: string): boolean {
  const lower = name.toLowerCase();
  return list.split(",").some((ext) => lower.endsWith(ext.trim().toLowerCase()));
}
