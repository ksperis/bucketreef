import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
  BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY,
  readBrowserRootContextSelection,
  readBrowserRootObjectColumns,
  readBrowserRootUiState,
  writeBrowserRootContextSelection,
  writeBrowserRootObjectColumns,
  writeBrowserRootUiLayout,
} from "./browserRootUiState";

describe("browserRootUiState v3", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("defaults to a compact, panel-free Browser", () => {
    expect(readBrowserRootUiState()).toMatchObject({
      density: "compact",
      showFolders: false,
      foldersPanelWidthPx: 280,
      objectColumns: [],
      objectColumnWidths: {},
    });
  });

  it("persists the folders preference and columns in one root Browser scope", () => {
    writeBrowserRootUiLayout({ showFolders: true });
    writeBrowserRootObjectColumns(["size", "modified"]);

    expect(readBrowserRootUiState()).toMatchObject({
      showFolders: true,
    });
    expect(readBrowserRootObjectColumns()).toEqual(["size", "modified"]);
  });

  it("keeps bucket and prefix selections in the current tab only", () => {
    writeBrowserRootContextSelection("conn-1", {
      bucketName: "bucket-a",
      prefix: "docs/",
    });

    expect(readBrowserRootContextSelection("conn-1")).toEqual({
      bucketName: "bucket-a",
      prefix: "docs/",
    });
    expect(
      window.sessionStorage.getItem(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY),
    ).toContain("bucket-a");
    expect(
      window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY),
    ).toBeNull();
  });
});
