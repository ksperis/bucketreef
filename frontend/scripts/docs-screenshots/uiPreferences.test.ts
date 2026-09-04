import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalStorageSeed } from "./types";
import { seedUiPreferences } from "./uiPreferences";

describe("documentation UI preference seed", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("clears stale identity data while restoring only the requested UI preferences", async () => {
    localStorage.setItem("token", "stale-docs-token");
    localStorage.setItem("user", '{"id":99}');
    sessionStorage.setItem("stale", "value");
    const page = {
      addInitScript: vi.fn(async (initialize: (seed: LocalStorageSeed) => void, seed: LocalStorageSeed) => initialize(seed)),
    } as unknown as Page;

    await seedUiPreferences(page, {
      selectedWorkspace: "portal",
      selectedPortalAccountId: "101",
      theme: "dark",
      extraEntries: { "browser:root-ui-state:v3": '{"density":"compact"}' },
      extraSessionEntries: { "bucket-list": '{"page":2}' },
    });

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(localStorage.getItem("selectedWorkspace")).toBe("portal");
    expect(localStorage.getItem("selectedPortalAccountId")).toBe("101");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("browser:root-ui-state:v3")).toBe('{"density":"compact"}');
    expect(localStorage.getItem("selectedManagerExecutionContextId")).toBeNull();
    expect(sessionStorage.getItem("stale")).toBeNull();
    expect(sessionStorage.getItem("bucket-list")).toBe('{"page":2}');
  });
});
