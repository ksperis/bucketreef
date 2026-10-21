/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import {
  VERSIONS_LIST_HARD_LIMIT,
  VERSIONS_PAGE_SIZE,
} from "./browserConstants";
import { useBrowserI18n } from "./browserI18n";
import { useBrowserVersionListing } from "./useBrowserVersionListing";

type UseBrowserPrefixVersionsOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName: string;
  contextEnabled: boolean;
  onWarning: (message: string) => void;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  versioningEnabled: boolean;
};

export function useBrowserPrefixVersions({
  contextId,
  bucketName,
  contextEnabled,
  onWarning,
  prefix,
  requestOptions,
  versioningEnabled,
}: UseBrowserPrefixVersionsOptions) {
  const { text, intlLocale } = useBrowserI18n();
  const [visible, setVisible] = useState(false);
  const handleHardLimit = useCallback(() => {
    onWarning(
      text(
        "Versions listing is limited to {count} entries. Narrow your path to continue.",
        {
          count: VERSIONS_LIST_HARD_LIMIT.toLocaleString(intlLocale),
        },
      ),
    );
  }, [intlLocale, onWarning, text]);
  const { canLoadMore, error, load, loading, rows } =
    useBrowserVersionListing({
      contextId,
      autoLoad: true,
      bucketName,
      enabled: visible && contextEnabled && versioningEnabled,
      errorMessage: "Unable to list versions for this prefix.",
      hardLimit: VERSIONS_LIST_HARD_LIMIT,
      onHardLimit: handleHardLimit,
      pageSize: VERSIONS_PAGE_SIZE,
      prefix,
      requestOptions,
    });

  useEffect(() => {
    if (!versioningEnabled) setVisible(false);
  }, [versioningEnabled]);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const refresh = useCallback(() => load({ force: true }), [load]);
  const refreshIfVisible = useCallback(async () => {
    if (!visible) return;
    await load({ force: true });
  }, [load, visible]);
  const loadMore = useCallback(() => load({ append: true }), [load]);

  return {
    canLoadMore,
    close,
    error,
    loadMore,
    loading,
    open,
    refresh,
    refreshIfVisible,
    rows,
    visible,
  };
}
