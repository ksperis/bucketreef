/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useLayoutEffect, type ComponentProps } from "react";
import type { BrowserFavorite } from "../../api/browserFavorites";
import BrowserFavoritesControl from "./BrowserFavoritesControl";
import {
  useBrowserSidebarSlot,
  type BrowserSidebarBodyRenderer,
} from "./BrowserLayout";
import BrowserWorkspaceSidebar from "./BrowserWorkspaceSidebar";

type FavoritesControlProps = ComponentProps<typeof BrowserFavoritesControl>;
type WorkspaceSidebarProps = ComponentProps<typeof BrowserWorkspaceSidebar>;

type UseBrowserWorkspaceSidebarBodyOptions = {
  enabled: boolean;
  favorites: Omit<FavoritesControlProps, "compact" | "onApply"> & {
    onApply: (favorite: BrowserFavorite) => Promise<boolean>;
  };
  sidebar: Omit<
    WorkspaceSidebarProps,
    | "favorites"
    | "compact"
    | "variant"
    | "closeMobile"
    | "panelViewportRef"
    | "loadMoreSentinelRef"
  >;
  panelViewportRef: WorkspaceSidebarProps["panelViewportRef"];
  loadMoreSentinelRef: WorkspaceSidebarProps["loadMoreSentinelRef"];
};

export function useBrowserWorkspaceSidebarBody({
  enabled,
  favorites,
  sidebar,
  panelViewportRef,
  loadMoreSentinelRef,
}: UseBrowserWorkspaceSidebarBodyOptions) {
  const { setSidebarBody } = useBrowserSidebarSlot();
  const {
    accountUser,
    bucketDetailsByName,
    bucketLabels,
    busy,
    contextLabels,
    current,
    error,
    favorites: favoriteItems,
    onApply,
    onRemove,
    unavailable,
  } = favorites;
  const {
    activeBucketName,
    bucketError,
    bucketFilter,
    bucketManagementEnabled,
    bucketMenuLoadingMore,
    bucketMenuTotal,
    bucketTotalCount,
    canLoadMore,
    isPortalContext,
    loadingBuckets,
    onBucketFilterChange,
    onCreateBucket,
    onLoadMore,
    onRetryBuckets,
    onSelectBucket,
    rows,
    usageError,
    usageLoading,
    usageSummary,
    workspaceAccountAction,
  } = sidebar;

  const renderSidebarBody = useCallback<BrowserSidebarBodyRenderer>(
    ({ compact, variant, closeMobile }) => (
      <BrowserWorkspaceSidebar
        favorites={
          <BrowserFavoritesControl
            accountUser={accountUser}
            bucketDetailsByName={bucketDetailsByName}
            bucketLabels={bucketLabels}
            busy={busy}
            compact={compact}
            contextLabels={contextLabels}
            current={current}
            error={error}
            favorites={favoriteItems}
            onApply={(favorite) => {
              void onApply(favorite).then((applied) => {
                if (applied && variant === "mobile") closeMobile();
              });
            }}
            onRemove={onRemove}
            unavailable={unavailable}
          />
        }
        compact={compact}
        variant={variant}
        closeMobile={closeMobile}
        isPortalContext={isPortalContext}
        rows={rows}
        activeBucketName={activeBucketName}
        bucketFilter={bucketFilter}
        loadingBuckets={loadingBuckets}
        bucketError={bucketError}
        bucketManagementEnabled={bucketManagementEnabled}
        canLoadMore={canLoadMore}
        bucketMenuLoadingMore={bucketMenuLoadingMore}
        bucketMenuTotal={bucketMenuTotal}
        bucketTotalCount={bucketTotalCount}
        usageSummary={usageSummary}
        usageLoading={usageLoading}
        usageError={usageError}
        panelViewportRef={variant === "desktop" ? panelViewportRef : undefined}
        loadMoreSentinelRef={
          variant === "desktop" ? loadMoreSentinelRef : undefined
        }
        onBucketFilterChange={onBucketFilterChange}
        onRetryBuckets={onRetryBuckets}
        onCreateBucket={onCreateBucket}
        onSelectBucket={onSelectBucket}
        onLoadMore={onLoadMore}
        workspaceAccountAction={workspaceAccountAction}
      />
    ),
    [
      accountUser,
      activeBucketName,
      bucketDetailsByName,
      bucketError,
      bucketFilter,
      bucketLabels,
      bucketManagementEnabled,
      bucketMenuLoadingMore,
      bucketMenuTotal,
      bucketTotalCount,
      busy,
      canLoadMore,
      contextLabels,
      current,
      error,
      favoriteItems,
      isPortalContext,
      loadMoreSentinelRef,
      loadingBuckets,
      onApply,
      onBucketFilterChange,
      onCreateBucket,
      onLoadMore,
      onRemove,
      onRetryBuckets,
      onSelectBucket,
      panelViewportRef,
      rows,
      unavailable,
      usageError,
      usageLoading,
      usageSummary,
      workspaceAccountAction,
    ],
  );

  useLayoutEffect(() => {
    if (!enabled) {
      setSidebarBody(null);
      return;
    }
    setSidebarBody(renderSidebarBody);
    return () => {
      setSidebarBody(null);
    };
  }, [enabled, renderSidebarBody, setSidebarBody]);
}
