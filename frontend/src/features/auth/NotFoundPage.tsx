/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import FullPageStatus from "../../components/FullPageStatus";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { readStoredUser, resolvePostLoginPath } from "../../utils/workspaces";

export default function NotFoundPage() {
  const location = useLocation();
  const { generalSettings, runtimeSurfaces } = useGeneralSettings();
  const homePath = useMemo(
    () => resolvePostLoginPath(readStoredUser(), generalSettings, runtimeSurfaces),
    [generalSettings, runtimeSurfaces],
  );
  const requestedPath = `${location.pathname}${location.search}`;
  const canReturnToWorkspace = homePath !== "/login" && homePath !== "/unauthorized";

  return (
    <FullPageStatus
      title="Page not found"
      description="The requested page does not exist or is no longer available."
      primaryAction={{
        label: canReturnToWorkspace ? "Back to workspace" : "Go to sign in",
        to: canReturnToWorkspace ? homePath : "/login",
        variant: "primary",
      }}
    >
      <p aria-label="Requested path" className="break-all font-mono ui-caption text-slate-500 dark:text-slate-400">
        {requestedPath}
      </p>
    </FullPageStatus>
  );
}
