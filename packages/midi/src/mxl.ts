import { decodeXml } from "./musicxml.js";
import { child, childrenOf, parseXml } from "./xml.js";

/**
 * 압축 MusicXML(.mxl)에서 악보 XML 글을 꺼낸다. .mxl은 zip 파일이고 META-INF/container.xml이 악보 파일을 가리킨다
 * (없으면 META-INF 밖의 첫 .musicxml·.xml). 압축은 저장(0)과 deflate(8)만 읽는다. 풀기는 브라우저의 DecompressionStream
 */
export class MxlError extends Error {}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

/** zip인지 (PK\x03\x04로 시작) */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function entries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 끝 레코드(EOCD)는 맨 뒤 22바이트 + 주석(최대 65535) 안에 있다
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new MxlError("zip 끝 레코드가 없습니다");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new MxlError("zip 목록이 깨졌습니다");
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    out.push({ name, method, compressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw new MxlError("zip 파일 머리가 깨졌습니다");
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new MxlError(`읽을 수 없는 압축 방식입니다: ${entry.method}`);
}

/** .mxl 바이트 → 악보 XML 글 */
export async function readMxl(bytes: Uint8Array): Promise<string> {
  const list = entries(bytes);
  let target: ZipEntry | undefined;
  const container = list.find((e) => e.name === "META-INF/container.xml");
  if (container) {
    const root = parseXml(decodeXml(await readEntry(bytes, container)));
    const path = childrenOf(child(root, "rootfiles"), "rootfile")
      .map((r) => r.attrs["full-path"])
      .find((p): p is string => !!p && !/\.(pdf|png|jpe?g|midi?)$/i.test(p));
    if (path) target = list.find((e) => e.name === path);
  }
  target ??= list.find((e) => !e.name.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(e.name));
  if (!target) throw new MxlError("zip 안에 악보 XML이 없습니다");
  return decodeXml(await readEntry(bytes, target));
}
