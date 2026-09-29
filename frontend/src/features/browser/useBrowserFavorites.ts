/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteBrowserFavorite,
  listBrowserFavorites,
  saveBrowserFavorite,
  type BrowserFavorite,
  type BrowserFavoriteInput,
} from "../../api/browserFavorites";
import { searchBrowserBuckets } from "../../api/browserBuckets";
import { listBrowserObjects } from "../../api/browserObjects";

const favoriteLocationKey = (favorite: BrowserFavoriteInput) =>
  [favorite.surface, favorite.workspace, favorite.context, favorite.bucket, favorite.prefix].join("\u0000");

const sameFavoriteLocation = (left: BrowserFavoriteInput, right: BrowserFavoriteInput) =>
  favoriteLocationKey(left) === favoriteLocationKey(right);

const messageFrom = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

export function browserFavoriteDefaultName({
  bucketName,
  bucketLabel,
  prefix,
}: {
  bucketName: string;
  bucketLabel?: string;
  prefix: string;
}) {
  const pathSegments = prefix.split("/").filter(Boolean);
  return pathSegments.at(-1) ?? (bucketLabel?.trim() || bucketName);
}

type UseBrowserFavoritesOptions = {
  accountUser: boolean;
  availableContexts: string[];
  current: BrowserFavoriteInput;
  enabled: boolean;
  lockedBucket?: string;
  onApply: (favorite: BrowserFavorite) => void;
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
};

export function useBrowserFavorites({
  accountUser,
  availableContexts,
  current,
  enabled,
  lockedBucket,
  onApply,
  onStatus,
  onWarning,
}: UseBrowserFavoritesOptions) {
  const active = useRef(true);
  const scope = useRef(current.context);
  scope.current = current.context;

  const [favorites, setFavorites] = useState<BrowserFavorite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!enabled || !accountUser) {
      if (active.current) {
        setFavorites([]);
        setLoaded(false);
        setError("");
      }
      return;
    }
    try {
      const next = await listBrowserFavorites(current.surface);
      if (!active.current) return;
      setFavorites(next);
      setError("");
    } catch (reason) {
      if (!active.current) return;
      setError(messageFrom(reason, "Unable to sync favorites."));
    } finally {
      if (active.current) setLoaded(true);
    }
  }, [accountUser, current.surface, enabled]);

  useEffect(() => {
    if (!enabled || !accountUser) return;
    void reload();
    const refresh = () => {
      void reload();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [accountUser, enabled, reload]);

  const uniqueFavorites = useMemo(() => {
    const seen = new Set<string>();
    return favorites.filter((favorite) => {
      const key = favoriteLocationKey(favorite);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [favorites]);

  const currentMatches = useMemo(
    () => favorites.filter((favorite) => sameFavoriteLocation(favorite, current)),
    [current, favorites],
  );

  const runMutation = useCallback(
    async (work: () => Promise<unknown>, successMessage: string) => {
      setMutationBusy(true);
      setError("");
      try {
        await work();
        await reload();
        onStatus?.(successMessage);
      } catch (reason) {
        const message = messageFrom(
          reason,
          "Unable to save favorite. Refresh and try again.",
        );
        await reload();
        if (active.current) setError(message);
        onWarning?.(message);
      } finally {
        if (active.current) setMutationBusy(false);
      }
    },
    [onStatus, onWarning, reload],
  );

  const toggleCurrent = useCallback(async () => {
    if (!enabled || !accountUser || !current.bucket || !current.context || mutationBusy) return;
    const matches = favorites.filter((favorite) => sameFavoriteLocation(favorite, current));
    if (matches.length > 0) {
      await runMutation(
        () => Promise.all(matches.map((favorite) => deleteBrowserFavorite(favorite))),
        "Removed from favorites.",
      );
      return;
    }
    await runMutation(() => saveBrowserFavorite(current), "Added to favorites.");
  }, [accountUser, current, enabled, favorites, mutationBusy, runMutation]);

  const removeLocation = useCallback(
    async (favorite: BrowserFavorite) => {
      if (mutationBusy) return;
      const matches = favorites.filter((candidate) => sameFavoriteLocation(candidate, favorite));
      await runMutation(
        () => Promise.all(matches.map((candidate) => deleteBrowserFavorite(candidate))),
        "Removed from favorites.",
      );
    },
    [favorites, mutationBusy, runMutation],
  );

  const apply = useCallback(
    async (favorite: BrowserFavorite) => {
      if (favorite.context !== current.context && !availableContexts.includes(favorite.context)) {
        setUnavailable((previous) => ({
          ...previous,
          [favorite.id]: `Select the saved context (${favorite.context}) to open this favorite.`,
        }));
        return false;
      }
      if (lockedBucket && favorite.bucket !== lockedBucket) {
        setUnavailable((previous) => ({
          ...previous,
          [favorite.id]: "Open this saved Storage Space to open this favorite.",
        }));
        return false;
      }
      setApplyingId(favorite.id);
      try {
        const result = await searchBrowserBuckets(favorite.context, {
          workspaceSurface: favorite.workspace,
          exact: true,
          search: favorite.bucket,
          pageSize: 1,
        });
        if (!result.items.some((item) => item.name === favorite.bucket)) {
          throw new Error("Saved location is unavailable. Its identity has been kept.");
        }
        await listBrowserObjects(favorite.context, favorite.bucket, {
          workspaceSurface: favorite.workspace,
          prefix: favorite.prefix,
          maxKeys: 1,
        });
        if (!active.current || scope.current !== current.context) return false;
        setUnavailable((previous) => {
          const next = { ...previous };
          delete next[favorite.id];
          return next;
        });
        onApply(favorite);
        return true;
      } catch (reason) {
        if (!active.current) return false;
        setUnavailable((previous) => ({
          ...previous,
          [favorite.id]: messageFrom(reason, "Saved location is unavailable."),
        }));
        return false;
      } finally {
        if (active.current) setApplyingId(null);
      }
    },
    [availableContexts, current.context, lockedBucket, onApply],
  );

  return {
    apply,
    busy: mutationBusy || applyingId !== null,
    canToggleCurrent:
      enabled &&
      accountUser &&
      loaded &&
      !error &&
      Boolean(current.bucket && current.context),
    error,
    favorites: uniqueFavorites,
    isCurrentFavorite: currentMatches.length > 0,
    loaded,
    removeLocation,
    toggleCurrent,
    unavailable,
  };
}
