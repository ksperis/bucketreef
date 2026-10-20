/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  CLIENT_STORAGE_KEYS,
  writeClientStorage,
} from "../../utils/clientStorage";
import { useBrowserI18n } from "./browserI18n";
import { resolveBrowserWorkspaceAccountDestination } from "./browserPageContextModel";

type UseBrowserWorkspaceAccountActionOptions = {
  selectedContext: ExecutionContext | null;
  contextIdForApi: string | null | undefined;
  isPortalBrowserSurface: boolean;
};

export function useBrowserWorkspaceAccountAction({
  selectedContext,
  contextIdForApi,
  isPortalBrowserSurface,
}: UseBrowserWorkspaceAccountActionOptions) {
  const navigate = useNavigate();
  const { text } = useBrowserI18n();
  const destination = useMemo(
    () =>
      resolveBrowserWorkspaceAccountDestination({
        selectedContext,
        contextIdForApi,
        isPortalBrowserSurface,
      }),
    [contextIdForApi, isPortalBrowserSurface, selectedContext],
  );

  const openWorkspaceAccount = useCallback(() => {
    if (!destination) return;
    writeClientStorage(
      destination.workspace === "manager"
        ? CLIENT_STORAGE_KEYS.selectedManagerExecutionContext
        : CLIENT_STORAGE_KEYS.selectedPortalAccount,
      destination.contextId,
    );
    writeClientStorage(
      CLIENT_STORAGE_KEYS.selectedWorkspace,
      destination.workspace,
    );
    navigate(destination.path);
  }, [destination, navigate]);

  return useMemo(() => {
    if (!destination) return undefined;
    if (destination.workspace === "manager") {
      return {
        label: text("Open in Manager"),
        title: text("Open this account in Manager"),
        onClick: openWorkspaceAccount,
      };
    }
    return {
      label: text("Open in Portal"),
      title: text("Open this account in Portal"),
      onClick: openWorkspaceAccount,
    };
  }, [destination, openWorkspaceAccount, text]);
}
