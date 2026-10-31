import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeId } from "./runtimeId";

describe("createRuntimeId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.fn(() => "runtime-uuid");
    vi.stubGlobal("crypto", { randomUUID });

    expect(createRuntimeId()).toBe("runtime-uuid");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timestamp and random suffix", () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createRuntimeId()).toMatch(/^123456789-[a-z0-9]+$/);
  });
});
