/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { BrowserObjectDetailsRouteTarget } from "../browser/browserPageContract";
import {
  resolveStorageSpaceObjectDetailsView,
  type StorageSpaceObjectDetailsView,
} from "../shared/objectDetailsContract";

export type PortalStorageSpaceDetailTab =
  | "files"
  | "collaborators"
  | "external-links"
  | "statistics"
  | "settings";

export function resolvePortalStorageSpaceDetailTab(search: string): PortalStorageSpaceDetailTab {
  const requestedTab = new URLSearchParams(search).get("tab");
  return requestedTab === "collaborators" ||
    requestedTab === "external-links" ||
    requestedTab === "statistics" ||
    requestedTab === "settings"
    ? requestedTab
    : "files";
}

export function usePortalStorageSpaceNavigation(lockedBucketName: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loadedObjectKeys, setLoadedObjectKeys] = useState<string[]>([]);
  const [objectCreateLinkRequestToken, setObjectCreateLinkRequestToken] = useState(0);

  const showDeletedFiles = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("show_deleted") === "1";
  }, [location.search]);

  const objectDrawerState = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const objectKey = params.get("object")?.trim() || null;
    const requestedView = params.get("object_view");
    const activeView: StorageSpaceObjectDetailsView =
      requestedView === "history" || requestedView === "sharing" || requestedView === "details"
        ? requestedView
        : "preview";
    return {
      activeView:
        params.get("object_deleted") === "1" && requestedView == null
          ? ("history" as const)
          : activeView,
      isDeleted: params.get("object_deleted") === "1",
      objectKey,
    };
  }, [location.search]);

  const selectTab = useCallback(
    (tab: PortalStorageSpaceDetailTab) => {
      const params = new URLSearchParams(location.search);
      if (tab !== "files") {
        params.delete("object");
        params.delete("object_view");
        params.delete("object_deleted");
      }
      if (tab === "files") params.delete("tab");
      else params.set("tab", tab);
      const search = params.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : "" },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const openObjectDetails = useCallback(
    (target: BrowserObjectDetailsRouteTarget) => {
      if (target.bucketName !== lockedBucketName) return;
      const params = new URLSearchParams(location.search);
      const replacingOpenDrawer = Boolean(params.get("object"));
      params.delete("tab");
      params.set("object", target.key);
      params.set("object_view", resolveStorageSpaceObjectDetailsView(target));
      if (target.isDeleted) params.set("object_deleted", "1");
      else params.delete("object_deleted");
      navigate(
        { pathname: location.pathname, search: `?${params.toString()}` },
        {
          replace: replacingOpenDrawer,
          state: { ...(location.state ?? {}), objectDrawerOpenedFromList: true },
        },
      );
      if (target.intent === "create-public-link") {
        setObjectCreateLinkRequestToken((current) => current + 1);
      }
    },
    [location.pathname, location.search, location.state, lockedBucketName, navigate],
  );

  const setDeletedFilesVisible = useCallback(
    (visible: boolean) => {
      const params = new URLSearchParams(location.search);
      params.delete("tab");
      if (visible) params.set("show_deleted", "1");
      else params.delete("show_deleted");
      const search = params.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : "" },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const closeObjectDrawer = useCallback(() => {
    const openedFromList = Boolean(
      (location.state as { objectDrawerOpenedFromList?: boolean } | null)?.objectDrawerOpenedFromList,
    );
    if (openedFromList) {
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete("object");
    params.delete("object_view");
    params.delete("object_deleted");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true, state: location.state },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  const setObjectDrawerView = useCallback(
    (view: StorageSpaceObjectDetailsView) => {
      const params = new URLSearchParams(location.search);
      params.set("object_view", view);
      navigate(
        { pathname: location.pathname, search: `?${params.toString()}` },
        { replace: true, state: location.state },
      );
    },
    [location.pathname, location.search, location.state, navigate],
  );

  const previewNavigation = useMemo(() => {
    const previewIndex = loadedObjectKeys.indexOf(objectDrawerState.objectKey ?? "");
    if (previewIndex < 0) return undefined;
    const navigatePreview = (index: number) => {
      const key = loadedObjectKeys[index];
      if (key === undefined) return;
      const params = new URLSearchParams(location.search);
      params.set("object", key);
      params.set("object_view", "preview");
      params.delete("object_deleted");
      navigate(
        { pathname: location.pathname, search: `?${params.toString()}` },
        { replace: true, state: location.state },
      );
    };
    return {
      previous: previewIndex > 0 ? () => navigatePreview(previewIndex - 1) : undefined,
      next:
        previewIndex + 1 < loadedObjectKeys.length
          ? () => navigatePreview(previewIndex + 1)
          : undefined,
      position: `${previewIndex + 1} / ${loadedObjectKeys.length}`,
    };
  }, [loadedObjectKeys, location.pathname, location.search, location.state, navigate, objectDrawerState.objectKey]);

  return {
    selectTab,
    showDeletedFiles,
    setDeletedFilesVisible,
    objectDrawerState,
    openObjectDetails,
    closeObjectDrawer,
    setObjectDrawerView,
    previewNavigation,
    setLoadedObjectKeys,
    objectCreateLinkRequestToken,
    clearObjectCreateLinkRequest: () => setObjectCreateLinkRequestToken(0),
  };
}
