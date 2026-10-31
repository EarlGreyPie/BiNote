/**
 * 바깥에서 들어온 파일 나누기: 창에 끌어다 놓은 파일, 설치한 앱으로 연 파일(file_handlers),
 * 폰 공유 시트로 받은 파일(share_target)을 같은 규칙으로 나눈다.
 * 악보는 하나만 연다(열기 메뉴와 같은 길). 원곡 음원도 하나만, 사운드팩은 놓은 만큼 올린다. 나머지는 건너뛴다.
 */
import { hasExtension } from "./fileAccept";

/** 이름과 형식만 보면 된다 (File 또는 시험용 가짜) */
export interface NamedFile {
  readonly name: string;
  readonly type: string;
}

/** 형식(type)이 비어 오는 때(안드로이드 공유 등)를 위해 확장자로도 보는 원곡 음원·영상 */
export const MEDIA_EXTENSIONS = ".mp3,.wav,.ogg,.oga,.opus,.flac,.m4a,.aac,.weba,.webm,.mp4,.m4v,.mov";

export interface IncomingPlan<T> {
  /** 열 악보 (처음 것 하나) */
  readonly score?: T;
  /** 원곡으로 불러올 음원·영상 (처음 것 하나) */
  readonly reference?: T;
  /** 올릴 사운드팩 */
  readonly packs: readonly T[];
  /** 건너뛴 것: 모르는 형식, 둘째부터의 악보·원곡 */
  readonly skipped: readonly T[];
}

/**
 * 들어온 파일을 나눈다. scores: 악보로 여는 확장자 목록(".mme,.mml"), packs: 사운드팩 확장자 목록.
 * 악보·사운드팩 확장자를 먼저 본다 (.mid를 audio/midi로 알려 주는 브라우저가 있어 형식보다 앞선다)
 */
export function planIncoming<T>(items: readonly T[], fileOf: (item: T) => NamedFile, lists: { scores: string; packs: string }): IncomingPlan<T> {
  let score: T | undefined;
  let reference: T | undefined;
  const packs: T[] = [];
  const skipped: T[] = [];
  for (const item of items) {
    const { name, type } = fileOf(item);
    if (hasExtension(name, lists.scores)) {
      if (score === undefined) score = item;
      else skipped.push(item);
    } else if (hasExtension(name, lists.packs)) packs.push(item);
    else if (/^(audio|video)\//.test(type) || hasExtension(name, MEDIA_EXTENSIONS)) {
      if (reference === undefined) reference = item;
      else skipped.push(item);
    } else skipped.push(item);
  }
  return { ...(score !== undefined ? { score } : {}), ...(reference !== undefined ? { reference } : {}), packs, skipped };
}

/** 끌고 있는 것에 파일이 들었는지 (dataTransfer.types). 글만 끌면 false */
export function draggingFiles(types: readonly string[] | undefined): boolean {
  return !!types && [...types].includes("Files");
}

/**
 * 파일 없이 글만 끄는지. 편집 칸 밖은 브라우저가 글을 받지 않는 자리라, dragover를 막아 두어야 놓을 때 drop이 온다
 * (안 막으면 drop 없이 끝난다)
 */
export function draggingText(types: readonly string[] | undefined): boolean {
  return !!types && !draggingFiles(types) && [...types].includes("text/plain");
}

/**
 * 창 전체 끌기 표시를 켜고 끈다. dragenter·dragleave는 안쪽 요소를 지날 때마다 짝지어 오므로 깊이를 센다.
 * 놓거나(drop) 창 밖으로 나가 깊이가 0이 되면 끈다
 */
export class DragDepth {
  private depth = 0;

  enter(): boolean {
    this.depth += 1;
    return true;
  }

  /** 아직 창 안이면 true */
  leave(): boolean {
    this.depth = Math.max(0, this.depth - 1);
    return this.depth > 0;
  }

  reset(): false {
    this.depth = 0;
    return false;
  }
}

/** 설치한 앱(Chromium)이 파일을 열 때 넘겨주는 것. TypeScript 기본 형식에 아직 없어 쓰는 것만 적는다 */
export interface LaunchParams {
  readonly files?: readonly FileSystemHandle[];
}
export interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** 이 브라우저의 launchQueue. 없으면(사파리·파이어폭스·설치하지 않은 탭) undefined */
export function launchQueueOf(target: unknown = globalThis): LaunchQueue | undefined {
  const queue = (target as { launchQueue?: LaunchQueue } | undefined)?.launchQueue;
  return queue && typeof queue.setConsumer === "function" ? queue : undefined;
}

/** 넘겨받은 것 가운데 파일만 연다. 폴더는 건너뛰고, 읽지 못한 파일도 건너뛴다 */
export async function launchedFiles(params: LaunchParams): Promise<{ file: File; handle: FileSystemFileHandle }[]> {
  const out: { file: File; handle: FileSystemFileHandle }[] = [];
  for (const handle of params.files ?? []) {
    if (handle.kind !== "file") continue;
    const fileHandle = handle as FileSystemFileHandle;
    try {
      out.push({ file: await fileHandle.getFile(), handle: fileHandle });
    } catch {
      // 그사이 지워졌거나 읽기 허락이 없다
    }
  }
  return out;
}
