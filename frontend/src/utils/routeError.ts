/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { GeneralSettings, RuntimeSurfaces } from "../api/appSettings";
import { readStoredUser, resolvePostLoginPath } from "./workspaces";

export function resolveRouteErrorHomePath(
  generalSettings: GeneralSettings,
  runtimeSurfaces?: RuntimeSurfaces,
): string {
  const nextPath = resolvePostLoginPath(readStoredUser(), generalSettings, runtimeSurfaces);
  if (nextPath === "/login" || nextPath === "/unauthorized") {
    return "/login";
  }
  return nextPath;
}
