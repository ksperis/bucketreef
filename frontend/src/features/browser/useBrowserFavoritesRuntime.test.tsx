import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserFavorite } from "../../api/browserFavorites";
import { useBrowserFavoritesRuntime } from "./useBrowserFavoritesRuntime";

const mocks = vi.hoisted(() => ({
  useFavorites: vi.fn(),
}));

vi.mock("./useBrowserFavorites", async () => {
  const actual = await vi.importActual<typeof import("./useBrowserFavorites")>(
    "./useBrowserFavorites",
  );
  return {
    ...actual,
    useBrowserFavorites: mocks.useFavorites,
  };
});

const favorite: BrowserFavorite = {
  id: "favorite-1",
  revision: 1,
  name: "Saved",
  surface: "browser",
  workspace: "browser",
  context: "101",
  bucket: "archive",
  prefix: "reports/",
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};

let currentLocation = "";

function LocationCapture() {
  const location = useLocation();
  currentLocation = `${location.pathname}${location.search}${location.hash}`;
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter
      initialEntries={[
        "/browser?ctx=101&bucket=archive&prefix=old%2F&view=grid#details",
      ]}
    >
      <LocationCapture />
      {children}
    </MemoryRouter>
  );
}

const favoritesState = {
  apply: vi.fn(),
  busy: false,
  canToggleCurrent: true,
  error: "",
  favorites: [],
  isCurrentFavorite: false,
  loaded: true,
  removeLocation: vi.fn(),
  toggleCurrent: vi.fn(),
  unavailable: {},
};

const options = () => ({
  storedUser: { id: 7, authType: "password" as const },
  contexts: [
    { id: "101", display_name: "Research" },
    { id: "202", display_name: "Archive" },
  ],
  bucketName: "archive",
  bucketLabel: "Research Data",
  prefix: "",
  isMainBrowserPath: true,
  workspaceSurface: "browser" as const,
  contextId: "101",
  lockedBucket: undefined,
  requestTransition: vi.fn((transition: () => void) => {
    transition();
    return true;
  }),
  setBucketName: vi.fn(),
  setPrefix: vi.fn(),
  onStatus: vi.fn(),
  onWarning: vi.fn(),
});

describe("useBrowserFavoritesRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLocation = "";
    mocks.useFavorites.mockReturnValue(favoritesState);
  });

  it("projects the current Browser location and execution contexts", () => {
    const runtimeOptions = options();
    const { result } = renderHook(
      () => useBrowserFavoritesRuntime(runtimeOptions),
      { wrapper },
    );

    expect(result.current.accountUser).toBe(true);
    expect(result.current.current).toEqual({
      name: "Research Data",
      surface: "browser",
      workspace: "browser",
      context: "101",
      bucket: "archive",
      prefix: "",
    });
    expect(result.current.contextLabels).toEqual({
      "101": "Research",
      "202": "Archive",
    });
    expect(mocks.useFavorites).toHaveBeenCalledWith(
      expect.objectContaining({
        accountUser: true,
        availableContexts: ["101", "202"],
        current: result.current.current,
        enabled: true,
      }),
    );
  });

  it("applies a favorite in the current context without changing the route", () => {
    const runtimeOptions = options();
    renderHook(() => useBrowserFavoritesRuntime(runtimeOptions), { wrapper });
    const favoritesOptions = mocks.useFavorites.mock.calls.at(-1)?.[0];

    act(() => {
      favoritesOptions.onApply(favorite);
    });

    expect(runtimeOptions.requestTransition).toHaveBeenCalledTimes(1);
    expect(runtimeOptions.setBucketName).toHaveBeenCalledWith("archive");
    expect(runtimeOptions.setPrefix).toHaveBeenCalledWith("reports/");
    expect(currentLocation).toBe(
      "/browser?ctx=101&bucket=archive&prefix=old%2F&view=grid#details",
    );
  });

  it("moves a cross-context favorite through the canonical Browser URL", () => {
    const runtimeOptions = options();
    renderHook(() => useBrowserFavoritesRuntime(runtimeOptions), { wrapper });
    const favoritesOptions = mocks.useFavorites.mock.calls.at(-1)?.[0];
    const crossContext = {
      ...favorite,
      context: "202",
      bucket: "reports",
      prefix: "2026/",
    };

    act(() => {
      favoritesOptions.onApply(crossContext);
    });

    expect(runtimeOptions.setBucketName).not.toHaveBeenCalled();
    expect(runtimeOptions.setPrefix).not.toHaveBeenCalled();
    expect(currentLocation).toBe(
      "/browser?ctx=202&bucket=reports&prefix=2026%2F&view=grid#details",
    );
  });
});
