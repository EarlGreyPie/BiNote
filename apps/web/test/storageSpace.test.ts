import { describe, expect, it } from "vitest";
import { estimateSpace, formatBytes, freeBytes, isQuotaError } from "../src/lib/storageSpace";

describe("저장 공간", () => {
  it("공간이 꽉 찬 오류를 가려낸다", () => {
    expect(isQuotaError(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
    expect(isQuotaError(new DOMException("closed", "InvalidStateError"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError("QuotaExceededError")).toBe(false);
  });

  it("쓰는 공간과 남은 공간을 읽고, 알려 주지 않으면 undefined", async () => {
    const space = await estimateSpace({ estimate: () => Promise.resolve({ usage: 3 * 1024 * 1024, quota: 10 * 1024 * 1024 }) });
    expect(space).toEqual({ usage: 3 * 1024 * 1024, quota: 10 * 1024 * 1024 });
    expect(freeBytes(space!)).toBe(7 * 1024 * 1024);
    expect(freeBytes({ usage: 5, quota: 3 })).toBe(0);
    expect(await estimateSpace({ estimate: () => Promise.resolve({}) })).toBeUndefined();
    expect(await estimateSpace({ estimate: () => Promise.reject(new Error("막힘")) })).toBeUndefined();
    expect(await estimateSpace(undefined)).toBeUndefined();
  });

  it("크기를 읽기 쉽게 적는다", () => {
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(120 * 1024 * 1024)).toBe("120 MB");
    expect(formatBytes(2.25 * 1024 * 1024 * 1024)).toBe("2.3 GB");
  });
});
