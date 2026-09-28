import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GENERAL_SETTINGS } from "../components/GeneralSettingsContext";
import { resolveRouteErrorHomePath } from "./routeError";
import { setSessionUserCache } from "./workspaces";

describe("resolveRouteErrorHomePath", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSessionUserCache(null);
  });

  it("returns the authenticated workspace home when available", () => {
    setSessionUserCache({ email: "admin@example.com", role: "ui_admin" });

    expect(resolveRouteErrorHomePath(DEFAULT_GENERAL_SETTINGS)).toBe("/admin");
  });

  it("falls back to login when there is no valid workspace", () => {
    expect(resolveRouteErrorHomePath(DEFAULT_GENERAL_SETTINGS)).toBe("/login");
  });
});
