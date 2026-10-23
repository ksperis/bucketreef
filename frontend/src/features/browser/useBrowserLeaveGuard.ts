/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useEffect } from "react";
import { unstable_usePrompt } from "react-router-dom";

type UseBrowserLeaveGuardOptions = {
  hasPendingOperations: boolean;
  hasUnsavedChanges: boolean;
  archiveInventoryActive: boolean;
};

function resolveLeaveMessage({
  hasPendingOperations,
  hasUnsavedChanges,
}: Pick<
  UseBrowserLeaveGuardOptions,
  "hasPendingOperations" | "hasUnsavedChanges"
>): string {
  if (hasUnsavedChanges) {
    return hasPendingOperations
      ? "Operations are in progress and the details drawer contains unapplied changes. Leaving now may interrupt operations and discard changes. Continue?"
      : "The details drawer contains unapplied changes. Leaving now will discard them. Continue?";
  }
  return hasPendingOperations
    ? "Operations are in progress (upload, download, copy, delete). Leaving now may interrupt them. Continue?"
    : "Archive inventory is in progress. Leaving now will cancel it. Continue?";
}

export function useBrowserLeaveGuard({
  hasPendingOperations,
  hasUnsavedChanges,
  archiveInventoryActive,
}: UseBrowserLeaveGuardOptions) {
  const shouldConfirmLeave =
    hasPendingOperations || hasUnsavedChanges || archiveInventoryActive;
  const leaveMessage = resolveLeaveMessage({
    hasPendingOperations,
    hasUnsavedChanges,
  });

  unstable_usePrompt({
    when: ({ currentLocation, nextLocation }) => {
      const pathChanged = currentLocation.pathname !== nextLocation.pathname;
      if (pathChanged) return shouldConfirmLeave;
      const searchChanged = currentLocation.search !== nextLocation.search;
      return searchChanged && (hasUnsavedChanges || archiveInventoryActive);
    },
    message: leaveMessage,
  });

  useEffect(() => {
    if (!shouldConfirmLeave || typeof window === "undefined") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = leaveMessage;
      return leaveMessage;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [leaveMessage, shouldConfirmLeave]);
}
