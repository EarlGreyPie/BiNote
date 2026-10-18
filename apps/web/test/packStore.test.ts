import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetPack, loadPacks, savePack, savePackOrder } from "../src/lib/packStore";

function pack(name: string, body = name): File {
  return new File([body], name);
}

async function names(): Promise<string[]> {
  return (await loadPacks()).map((p) => p.name);
}

beforeEach(async () => {
  for (const p of await loadPacks()) await forgetPack(p.name);
});

describe("packStore", () => {
  it("순서를 바꾸면 다시 불러올 때 바꾼 순서로 돌려준다", async () => {
    for (const n of ["a", "b", "c"]) expect(await savePack(pack(n))).toBe(true);
    expect(await names()).toEqual(["a", "b", "c"]);
    await savePackOrder(["c", "a", "b"]);
    expect(await names()).toEqual(["c", "a", "b"]);
  });

  it("순서 저장과 빼기를 동시에 해도 뺀 팩이 되살아나지 않는다", async () => {
    for (const n of ["a", "b", "c"]) await savePack(pack(n));
    await Promise.all([savePackOrder(["c", "b", "a"]), forgetPack("b")]);
    expect(await names()).toEqual(["c", "a"]);
  });

  it("순서를 바꾼 직후 올린 팩은 맨 아래에 온다", async () => {
    for (const n of ["a", "b", "c"]) await savePack(pack(n));
    await savePackOrder(["c", "b", "a"]);
    await savePack(pack("d"));
    expect(await names()).toEqual(["c", "b", "a", "d"]);
  });

  it("같은 이름을 다시 올리면 데이터는 새 것이고 맨 아래로 간다 (앱에서 바꿔 끼운 순서와 같게)", async () => {
    for (const n of ["a", "b", "c"]) await savePack(pack(n, "old"));
    await savePack(pack("a", "new"));
    const all = await loadPacks();
    expect(all.map((p) => p.name)).toEqual(["b", "c", "a"]);
    expect(await all[2]!.data.text()).toBe("new");
  });

  it("목록 밖 팩은 원래 순서를 지킨 채 뒤로 간다 (다른 탭에서 그사이 올린 팩)", async () => {
    for (const n of ["B", "C", "Z", "A"]) await savePack(pack(n));
    await savePackOrder(["C", "B"]);
    expect(await names()).toEqual(["C", "B", "Z", "A"]);
  });

  it("목록 밖 팩이 셋 이상이어도 원래 순서를 지킨다", async () => {
    for (const n of ["m", "y", "b", "x", "a"]) await savePack(pack(n));
    await savePackOrder(["b"]);
    expect(await names()).toEqual(["b", "m", "y", "x", "a"]);
    // 한 번 더 저장해도 그대로
    await savePackOrder(["b"]);
    expect(await names()).toEqual(["b", "m", "y", "x", "a"]);
  });

  it("목록에 있지만 저장소에 없는 이름은 무시한다", async () => {
    for (const n of ["a", "b"]) await savePack(pack(n));
    await savePackOrder(["gone", "b", "a"]);
    expect(await names()).toEqual(["b", "a"]);
  });
});
