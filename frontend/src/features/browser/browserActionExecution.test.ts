import { describe, expect, it, vi } from "vitest";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  resolveBrowserActions,
} from "./browserActions";
import { createBrowserActionExecution } from "./browserActionExecution";
import type { BrowserItem } from "./browserTypes";

const fileItem: BrowserItem = {
  id: "file-1",
  key: "a.txt",
  name: "a.txt",
  type: "file",
  size: "10 B",
  sizeBytes: 10,
  modified: "2026-03-10 10:15",
  modifiedAt: 0,
  owner: "owner",
};

const folderItem: BrowserItem = {
  id: "folder-1",
  key: "docs/",
  name: "docs",
  type: "folder",
  size: "-",
  sizeBytes: 0,
  modified: "2026-03-10 10:15",
  modifiedAt: 0,
  owner: "owner",
};

const baseInput = {
  bucketName: "bucket-1",
  hasExecutionContext: true,
  versioningEnabled: true,
  canPaste: true,
  functionalProfile: "advanced" as const,
  capabilityFacts: FULL_BROWSER_CAPABILITY_FACTS,
};

const createItemHandlers = () => ({
  downloadArchive: vi.fn(),
  downloadFolder: vi.fn(),
  downloadItems: vi.fn(),
  openDetails: vi.fn(),
  openVersions: vi.fn(),
  openProperties: vi.fn(),
  openItem: vi.fn(),
  previewItem: vi.fn(),
  downloadTarget: vi.fn(),
  createPublicLink: vi.fn(),
  restoreDeletedItem: vi.fn(),
  copyUrl: vi.fn(),
  copyItems: vi.fn(),
  cutItems: vi.fn(),
  openBulkAttributes: vi.fn(),
  openBulkRestore: vi.fn(),
  deleteItems: vi.fn(),
});

describe("createBrowserActionExecution", () => {
  it("dispatches path and folder selection actions through their canonical handlers", () => {
    const newFolder = vi.fn();
    const itemHandlers = createItemHandlers();
    const pathActionStates = resolveBrowserActions({
      ...baseInput,
      scope: "path",
      currentPath: "bucket-1/docs",
    });
    const selectionActionStates = resolveBrowserActions({
      ...baseInput,
      scope: "selection",
      items: [folderItem],
    });
    const execution = createBrowserActionExecution({
      pathActionStates,
      selectionActionStates,
      resolveItemActionStates: (item) =>
        resolveBrowserActions({
          ...baseInput,
          scope: "item",
          items: [item],
          previewAvailable: true,
        }),
      pathHandlers: { newFolder },
      itemHandlers,
      selection: {
        items: [folderItem],
        files: [],
        primary: folderItem,
        isSearchingInWholeBucket: false,
        normalizedPrefix: "docs/",
      },
      onItemActionRejected: vi.fn(),
    });

    execution.runPathAction("newFolder");
    execution.runSelectionAction("download");

    expect(newFolder).toHaveBeenCalledTimes(1);
    expect(itemHandlers.downloadFolder).toHaveBeenCalledWith(folderItem);
    expect(itemHandlers.downloadItems).not.toHaveBeenCalled();
  });

  it("reports rejected item actions without invoking their handler", () => {
    const itemHandlers = createItemHandlers();
    const onItemActionRejected = vi.fn();
    const pathActionStates = resolveBrowserActions({
      ...baseInput,
      scope: "path",
      currentPath: "bucket-1",
    });
    const selectionActionStates = resolveBrowserActions({
      ...baseInput,
      scope: "selection",
      items: [fileItem],
    });
    const execution = createBrowserActionExecution({
      pathActionStates,
      selectionActionStates,
      resolveItemActionStates: (item) =>
        resolveBrowserActions({
          ...baseInput,
          scope: "item",
          items: [item],
          previewAvailable: true,
          copyUrlDisabled: true,
          copyUrlDisabledReason: "Copy URL is disabled in SSE-C mode.",
        }),
      pathHandlers: {},
      itemHandlers,
      selection: {
        items: [fileItem],
        files: [fileItem],
        primary: fileItem,
        isSearchingInWholeBucket: false,
        normalizedPrefix: "",
      },
      onItemActionRejected,
    });

    execution.runItemAction(fileItem, "copyUrl");

    expect(itemHandlers.copyUrl).not.toHaveBeenCalled();
    expect(onItemActionRejected).toHaveBeenCalledWith(
      "Copy URL is disabled in SSE-C mode.",
    );
  });
});
