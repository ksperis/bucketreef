/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo } from "react";
import type { BrowserFunctionalProfile } from "./browserActions";
import { resolveItemPrimaryAction } from "./browserActions";
import {
  resolveBrowserObjectDetailsTab,
  resolveRoutedObjectDetailsTab,
} from "./browserObjectDetailsModel";
import type { BrowserObjectDetailsRouteTarget } from "./browserPageContract";
import type { BrowserItem, ObjectDetailsTabId } from "./browserTypes";
import { useBrowserI18n } from "./browserI18n";

type ObjectDetailsTarget = {
  item: BrowserItem;
} | null;

type UseBrowserObjectNavigationOptions = {
  bucketName: string;
  functionalProfile: BrowserFunctionalProfile;
  isStorageSpaceContext: boolean;
  listItems: BrowserItem[];
  objectDetailsTarget: ObjectDetailsTarget;
  onActivateItem: (item: BrowserItem) => void;
  onLoadedFilesChange?: (keys: string[]) => void;
  onOpenFolder: (prefix: string) => void;
  onOpenObjectDetails?: (target: BrowserObjectDetailsRouteTarget) => void;
  openObjectDetailsTarget: (
    item: BrowserItem,
    initialTab: ObjectDetailsTabId,
    intent?: "create-public-link",
  ) => void;
  requestDetailsDrawerTransition: (transition: () => void) => boolean;
  setWarningMessage: (message: string | null) => void;
  versioningEnabled: boolean;
};

export function useBrowserObjectNavigation({
  bucketName,
  functionalProfile,
  isStorageSpaceContext,
  listItems,
  objectDetailsTarget,
  onActivateItem,
  onLoadedFilesChange,
  onOpenFolder,
  onOpenObjectDetails,
  openObjectDetailsTarget,
  requestDetailsDrawerTransition,
  setWarningMessage,
  versioningEnabled,
}: UseBrowserObjectNavigationOptions) {
  const { text } = useBrowserI18n();
  const previewFiles = useMemo(
    () => listItems.filter((item) => item.type === "file" && !item.isDeleted),
    [listItems],
  );

  useEffect(() => {
    onLoadedFilesChange?.(previewFiles.map((item) => item.key));
  }, [onLoadedFilesChange, previewFiles]);

  const openObjectDetails = useCallback(
    (
      item: BrowserItem,
      requestedTab: ObjectDetailsTabId,
      intent?: "create-public-link",
    ) => {
      if (item.type !== "file") return;
      if (onOpenObjectDetails) {
        onOpenObjectDetails({
          bucketName,
          key: item.key,
          name: item.name || item.key,
          initialTab: resolveRoutedObjectDetailsTab({
            isDeleted: Boolean(item.isDeleted),
            requestedTab,
          }),
          isDeleted: Boolean(item.isDeleted),
          intent,
        });
        return;
      }

      const resolution = resolveBrowserObjectDetailsTab({
        isDeleted: Boolean(item.isDeleted),
        isStorageSpace: isStorageSpaceContext,
        profile: functionalProfile === "advanced" ? "advanced" : "standard",
        requestedTab,
        versioningEnabled,
      });
      if (resolution.warning) setWarningMessage(text(resolution.warning));
      if (!resolution.initialTab) return;
      const initialTab = resolution.initialTab;
      requestDetailsDrawerTransition(() => {
        onActivateItem(item);
        openObjectDetailsTarget(item, initialTab, intent);
      });
    },
    [
      bucketName,
      functionalProfile,
      isStorageSpaceContext,
      onActivateItem,
      onOpenObjectDetails,
      openObjectDetailsTarget,
      requestDetailsDrawerTransition,
      setWarningMessage,
      text,
      versioningEnabled,
    ],
  );

  const openItemPrimaryAction = useCallback(
    (item: BrowserItem) => {
      const primaryAction = resolveItemPrimaryAction(item, {
        versioningEnabled,
      });
      if (primaryAction.kind === "open-folder") {
        onOpenFolder(item.key);
      } else if (primaryAction.kind === "open-versions") {
        openObjectDetails(item, "versions");
      } else if (primaryAction.kind === "open-file") {
        openObjectDetails(item, primaryAction.initialTab);
      }
    },
    [onOpenFolder, openObjectDetails, versioningEnabled],
  );

  const createPublicLinkForItem = useCallback(
    (item: BrowserItem) => {
      if (item.type !== "file" || item.isDeleted) return;
      openObjectDetails(item, "details", "create-public-link");
    },
    [openObjectDetails],
  );

  const openItemDetails = useCallback(
    (item: BrowserItem) => {
      if (item.type === "folder") {
        if (functionalProfile !== "advanced") return;
        requestDetailsDrawerTransition(() => {
          onActivateItem(item);
          openObjectDetailsTarget(item, "details");
        });
        return;
      }
      openObjectDetails(
        item,
        item.isDeleted
          ? "versions"
          : functionalProfile === "advanced"
            ? "properties"
            : "details",
      );
    },
    [
      functionalProfile,
      onActivateItem,
      openObjectDetails,
      openObjectDetailsTarget,
      requestDetailsDrawerTransition,
    ],
  );

  const openPropertiesForItem = useCallback(
    (item: BrowserItem) => openObjectDetails(item, "properties"),
    [openObjectDetails],
  );
  const previewItem = useCallback(
    (item: BrowserItem) => openObjectDetails(item, "preview"),
    [openObjectDetails],
  );

  const previewNavigation = useMemo(() => {
    const previewIndex = previewFiles.findIndex(
      (item) => item.key === objectDetailsTarget?.item.key,
    );
    if (previewIndex < 0) return undefined;
    return {
      previous:
        previewIndex > 0
          ? () =>
              requestDetailsDrawerTransition(() =>
                openObjectDetailsTarget(
                  previewFiles[previewIndex - 1],
                  "preview",
                ),
              )
          : undefined,
      next:
        previewIndex + 1 < previewFiles.length
          ? () =>
              requestDetailsDrawerTransition(() =>
                openObjectDetailsTarget(
                  previewFiles[previewIndex + 1],
                  "preview",
                ),
              )
          : undefined,
      position: `${previewIndex + 1} / ${previewFiles.length}`,
    };
  }, [
    objectDetailsTarget?.item.key,
    openObjectDetailsTarget,
    previewFiles,
    requestDetailsDrawerTransition,
  ]);

  return {
    createPublicLinkForItem,
    openItemDetails,
    openItemPrimaryAction,
    openObjectDetails,
    openPropertiesForItem,
    previewItem,
    previewNavigation,
  };
}
