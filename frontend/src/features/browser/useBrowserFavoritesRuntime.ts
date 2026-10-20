/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { BrowserFavorite } from "../../api/browserFavorites";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import type { SessionUser } from "../../utils/workspaces";
import { buildBrowserLocationPath } from "./useBrowserNavigationHistory";
import {
  browserFavoriteDefaultName,
  useBrowserFavorites,
} from "./useBrowserFavorites";

type FavoriteContext = {
  id: string;
  display_name: string;
};

type UseBrowserFavoritesRuntimeOptions = {
  storedUser: SessionUser | null;
  contexts: ReadonlyArray<FavoriteContext>;
  bucketName: string;
  bucketLabel?: string;
  prefix: string;
  isMainBrowserPath: boolean;
  workspaceSurface: BrowserWorkspaceSurface;
  contextId: string | number | null | undefined;
  lockedBucket?: string;
  requestTransition: (transition: () => void) => boolean;
  setBucketName: (bucketName: string) => void;
  setPrefix: (prefix: string) => void;
  clearActiveItem: () => void;
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
};

export function useBrowserFavoritesRuntime({
  storedUser,
  contexts,
  bucketName,
  bucketLabel,
  prefix,
  isMainBrowserPath,
  workspaceSurface,
  contextId,
  lockedBucket,
  requestTransition,
  setBucketName,
  setPrefix,
  clearActiveItem,
  onStatus,
  onWarning,
}: UseBrowserFavoritesRuntimeOptions) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountUser = Boolean(storedUser && storedUser.authType !== "s3_session");
  const context = String(contextId ?? "");
  const current = useMemo(
    () => ({
      name: browserFavoriteDefaultName({
        bucketName,
        bucketLabel,
        prefix,
      }),
      surface: isMainBrowserPath ? ("browser" as const) : workspaceSurface,
      workspace: workspaceSurface,
      context,
      bucket: bucketName,
      prefix,
    }),
    [
      bucketLabel,
      bucketName,
      context,
      isMainBrowserPath,
      prefix,
      workspaceSurface,
    ],
  );
  const contextLabels = useMemo(
    () => Object.fromEntries(contexts.map((item) => [item.id, item.display_name])),
    [contexts],
  );
  const availableContexts = useMemo(
    () => (isMainBrowserPath ? contexts.map((item) => item.id) : []),
    [contexts, isMainBrowserPath],
  );
  const applyFavorite = useCallback(
    (favorite: BrowserFavorite) =>
      requestTransition(() => {
        if (favorite.context !== context) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set("ctx", favorite.context);
          navigate(
            buildBrowserLocationPath(
              location.pathname,
              nextParams.toString(),
              location.hash,
              { bucketName: favorite.bucket, prefix: favorite.prefix },
            ),
          );
        } else {
          setBucketName(favorite.bucket);
          setPrefix(favorite.prefix);
        }
        clearActiveItem();
      }),
    [
      clearActiveItem,
      context,
      location.hash,
      location.pathname,
      navigate,
      requestTransition,
      searchParams,
      setBucketName,
      setPrefix,
    ],
  );
  const favorites = useBrowserFavorites({
    accountUser,
    availableContexts,
    current,
    enabled: isMainBrowserPath,
    lockedBucket,
    onApply: applyFavorite,
    onStatus,
    onWarning,
  });

  return {
    accountUser,
    contextLabels,
    current,
    ...favorites,
  };
}
