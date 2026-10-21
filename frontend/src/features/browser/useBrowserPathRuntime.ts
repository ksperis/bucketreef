/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useCallback, useMemo } from "react";

import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import { hasOpenModal } from "../../components/ui/modalStack";
import { buildPrefixBreadcrumbs } from "./browserUtils";
import { useBrowserNavigationHistory } from "./useBrowserNavigationHistory";
import { useBrowserPathEditor } from "./useBrowserPathEditor";
import { useBrowserPathHistory } from "./useBrowserPathHistory";

type UseBrowserPathRuntimeOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName: string;
  prefix: string;
  localPrefixes: string[];
  enabled: boolean;
  requestOptions?: BrowserRequestOptions;
  requestTransition: (transition: () => void) => boolean;
  setPrefix: (prefix: string) => void;
  selectionReady: boolean;
  contextSwitchInFlight: boolean;
  normalizedPath: string;
  accessContextKey: string | null;
  lockedBucketName?: string;
};

export function useBrowserPathRuntime({
  contextId,
  bucketName,
  prefix,
  localPrefixes,
  enabled,
  requestOptions,
  requestTransition,
  setPrefix,
  selectionReady,
  contextSwitchInFlight,
  normalizedPath,
  accessContextKey,
  lockedBucketName = "",
}: UseBrowserPathRuntimeOptions) {
  const { history, record } = useBrowserPathHistory({ bucketName });
  const selectPrefix = useCallback(
    (nextPrefix: string) => {
      requestTransition(() => {
        setPrefix(nextPrefix);
        record(nextPrefix);
      });
    },
    [record, requestTransition, setPrefix],
  );
  const editor = useBrowserPathEditor({
    contextId,
    bucketName,
    enabled,
    history,
    localPrefixes,
    onCommit: selectPrefix,
    prefix,
    requestOptions,
  });

  useBrowserNavigationHistory({
    bucketName,
    prefix,
    lockedBucketName,
    ready: enabled && selectionReady && !contextSwitchInFlight,
    scopeKey: [normalizedPath, accessContextKey ?? "none", lockedBucketName].join(":"),
    onNavigate: ({ bucketName: nextBucket, prefix: nextPrefix }) => {
      if (hasOpenModal()) return false;
      return requestTransition(() => {
        // Bucket changes are validated by the catalogue from the URL before
        // they replace the current selection. Prefix-only history is local.
        if (nextBucket === bucketName) setPrefix(nextPrefix);
        editor.cancel();
      });
    },
  });

  const breadcrumbs = useMemo(() => buildPrefixBreadcrumbs(prefix), [prefix]);
  const parentPrefix = breadcrumbs.at(-2)?.prefix ?? "";
  const currentPath = useMemo(() => {
    if (!bucketName) return "";
    if (!prefix) return bucketName;
    const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return bucketName + "/" + trimmed;
  }, [bucketName, prefix]);
  const goUp = useCallback(() => {
    if (breadcrumbs.length === 0) return;
    selectPrefix(parentPrefix);
  }, [breadcrumbs.length, parentPrefix, selectPrefix]);

  return {
    breadcrumbs,
    canGoUp: breadcrumbs.length > 0,
    currentPath,
    editor,
    goUp,
    selectPrefix,
  };
}
