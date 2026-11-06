/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { BrowserFavorite } from "../../api/browserFavorites";
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
  contextId: string | number | null | undefined;
  lockedBucket?: string;
  requestTransition: (transition: () => void) => boolean;
  setBucketName: (bucketName: string) => void;
  setPrefix: (prefix: string) => void;
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
  contextId,
  lockedBucket,
  requestTransition,
  setBucketName,
  setPrefix,
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
      context,
      bucket: bucketName,
      prefix,
    }),
    [
      bucketLabel,
      bucketName,
      context,
      prefix,
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
      }),
    [
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
