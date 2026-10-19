import { describe, expect, it } from "vitest";

import {
  resolveBrowserUploadMode,
  shouldUseStsPresigner,
} from "../sseBrowserLogic";

describe("sseBrowserLogic", () => {
  it("bypasses STS presigner when SSE-C is active", () => {
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: true })).toBe(false);
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: false })).toBe(true);
  });

  it("selects STS, direct, then proxy for uploads", () => {
    const base = {
      settingsLoaded: true,
      hasContext: true,
      hasBucket: true,
      corsEnabled: true,
      directAllowed: true,
      stsAllowed: true,
      stsAvailable: true,
      sseActive: false,
      proxyAllowed: true,
    };

    expect(resolveBrowserUploadMode(base)).toBe("sts");
    expect(resolveBrowserUploadMode({ ...base, stsAllowed: false })).toBe("direct");
    expect(
      resolveBrowserUploadMode({
        ...base,
        stsAllowed: false,
        directAllowed: false,
      }),
    ).toBe("proxy");
  });

  it("uses proxy when CORS blocks direct uploads and disables STS-only uploads when unavailable", () => {
    const base = {
      settingsLoaded: true,
      hasContext: true,
      hasBucket: true,
      corsEnabled: false,
      directAllowed: true,
      stsAllowed: true,
      stsAvailable: true,
      sseActive: false,
      proxyAllowed: true,
    };

    expect(resolveBrowserUploadMode(base)).toBe("proxy");
    expect(resolveBrowserUploadMode({ ...base, proxyAllowed: false })).toBe(
      "unavailable",
    );
    expect(
      resolveBrowserUploadMode({
        ...base,
        corsEnabled: true,
        directAllowed: false,
        stsAvailable: false,
        proxyAllowed: false,
      }),
    ).toBe("unavailable");
    expect(
      resolveBrowserUploadMode({ ...base, settingsLoaded: false }),
    ).toBe("unavailable");
  });

  it("falls back from STS to direct or proxy when SSE-C is active", () => {
    const base = {
      settingsLoaded: true,
      hasContext: true,
      hasBucket: true,
      corsEnabled: null,
      directAllowed: true,
      stsAllowed: true,
      stsAvailable: true,
      sseActive: true,
      proxyAllowed: true,
    };

    expect(resolveBrowserUploadMode(base)).toBe("direct");
    expect(
      resolveBrowserUploadMode({ ...base, directAllowed: false }),
    ).toBe("proxy");
  });
});
