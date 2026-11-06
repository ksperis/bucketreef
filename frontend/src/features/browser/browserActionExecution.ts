/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  runBrowserAction,
  type BrowserActionId,
  type BrowserActionMap,
} from "./browserActions";
import type { BrowserItem } from "./browserTypes";

type BrowserActionResult = void | Promise<void>;
type BrowserActionHandler = () => BrowserActionResult;
type BrowserItemHandler = (item: BrowserItem) => BrowserActionResult;
type BrowserItemsHandler = (items: BrowserItem[]) => BrowserActionResult;

type BrowserPathActionHandlers = Partial<
  Record<BrowserActionId, BrowserActionHandler>
>;

type BrowserItemActionHandlers = {
  downloadArchive: (items: BrowserItem[], basePrefix: string) => BrowserActionResult;
  downloadFolder: BrowserItemHandler;
  downloadItems: BrowserItemsHandler;
  openDetails: BrowserItemHandler;
  openVersions: BrowserItemHandler;
  openProperties: BrowserItemHandler;
  openItem: BrowserItemHandler;
  previewItem: BrowserItemHandler;
  downloadTarget: BrowserItemHandler;
  createPublicLink: BrowserItemHandler;
  restoreDeletedItem: BrowserItemHandler;
  copyUrl: (item: BrowserItem | null) => BrowserActionResult;
  copyItems: BrowserItemsHandler;
  cutItems: BrowserItemsHandler;
  openBulkAttributes: BrowserItemsHandler;
  openBulkRestore: BrowserItemsHandler;
  deleteItems: BrowserItemsHandler;
};

type BrowserSelectionActionContext = {
  items: BrowserItem[];
  files: BrowserItem[];
  primary: BrowserItem | null;
  isSearchingInWholeBucket: boolean;
  normalizedPrefix: string;
};

type BrowserActionExecutionOptions = {
  pathActionStates: BrowserActionMap;
  selectionActionStates: BrowserActionMap;
  resolveItemActionStates: (item: BrowserItem) => BrowserActionMap;
  pathHandlers: BrowserPathActionHandlers;
  itemHandlers: BrowserItemActionHandlers;
  selection: BrowserSelectionActionContext;
  onItemActionRejected: (reason: string) => void;
};

export const createBrowserActionExecution = ({
  pathActionStates,
  selectionActionStates,
  resolveItemActionStates,
  pathHandlers,
  itemHandlers,
  selection,
  onItemActionRejected,
}: BrowserActionExecutionOptions) => {
  const archiveBasePrefix = selection.isSearchingInWholeBucket
    ? ""
    : selection.normalizedPrefix;

  const runPathAction = (actionId: BrowserActionId) => {
    runBrowserAction(pathActionStates[actionId], pathHandlers);
  };

  const runSelectionAction = (actionId: BrowserActionId) => {
    runBrowserAction(selectionActionStates[actionId], {
      downloadZip: () =>
        itemHandlers.downloadArchive(selection.items, archiveBasePrefix),
      details: () => {
        if (selection.primary) itemHandlers.openDetails(selection.primary);
      },
      download: () => {
        if (
          selectionActionStates.download.label === "Download folder" &&
          selection.primary
        ) {
          return itemHandlers.downloadFolder(selection.primary);
        }
        return itemHandlers.downloadItems(selection.files);
      },
      open: () => {
        if (selection.primary) itemHandlers.openItem(selection.primary);
      },
      copyUrl: () => itemHandlers.copyUrl(selection.primary),
      copy: () => itemHandlers.copyItems(selection.items),
      cut: () => itemHandlers.cutItems(selection.items),
      bulkAttributes: () => itemHandlers.openBulkAttributes(selection.items),
      advanced: () => {
        if (selection.primary) itemHandlers.openProperties(selection.primary);
      },
      restoreToDate: () => itemHandlers.openBulkRestore(selection.items),
      delete: () => itemHandlers.deleteItems(selection.items),
    });
  };

  const runItemAction = (item: BrowserItem, actionId: BrowserActionId) => {
    const result = runBrowserAction(resolveItemActionStates(item)[actionId], {
      downloadZip: () => itemHandlers.downloadArchive([item], archiveBasePrefix),
      details: () => itemHandlers.openDetails(item),
      versions: () => itemHandlers.openVersions(item),
      properties: () => itemHandlers.openProperties(item),
      open: () => itemHandlers.openItem(item),
      preview: () => itemHandlers.previewItem(item),
      download: () => itemHandlers.downloadTarget(item),
      createPublicLink: () => itemHandlers.createPublicLink(item),
      restore: () => itemHandlers.restoreDeletedItem(item),
      copyUrl: () => itemHandlers.copyUrl(item),
      copy: () => itemHandlers.copyItems([item]),
      cut: () => itemHandlers.cutItems([item]),
      bulkAttributes: () => itemHandlers.openBulkAttributes([item]),
      restoreToDate: () => itemHandlers.openBulkRestore([item]),
      advanced: () => itemHandlers.openProperties(item),
      delete: () => itemHandlers.deleteItems([item]),
    });
    if (!result.executed) {
      onItemActionRejected(result.reason);
    }
  };

  return {
    runItemAction,
    runPathAction,
    runSelectionAction,
  };
};
