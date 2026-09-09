/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { PortalStorageSpaceSettings } from "../../api/portal";

export type SpaceHistoryDraft = {
  versioning_enabled: boolean;
  lifecycle_enabled: boolean;
  version_history_retention_days: string;
};

export function historyDraft(settings: PortalStorageSpaceSettings): SpaceHistoryDraft {
  return { versioning_enabled: settings.versioning_enabled, lifecycle_enabled: settings.lifecycle_enabled,
    version_history_retention_days: String(settings.version_history_retention_days) };
}

export function mergeSpaceHistory(baseline: SpaceHistoryDraft, draft: SpaceHistoryDraft, latest: PortalStorageSpaceSettings) {
  const current = historyDraft(latest);
  const result = { ...current };
  const conflicts: (keyof SpaceHistoryDraft)[] = [];
  for (const key of Object.keys(draft) as (keyof SpaceHistoryDraft)[]) {
    // Retention has no durable setting when the managed rules are removed.
    if (key === "version_history_retention_days" && !draft.lifecycle_enabled) continue;
    if (baseline[key] === draft[key]) continue;
    if (current[key] !== baseline[key] && current[key] !== draft[key]) conflicts.push(key);
    Object.assign(result, { [key]: draft[key] });
  }
  return { conflicts, payload: { ...result, version_history_retention_days: Number(result.version_history_retention_days) } };
}
