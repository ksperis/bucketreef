/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { PortalSettingsOverride } from "../../api/appSettings";
import type { PortalProjectSettings } from "../../api/portalAccounts";
type TriState = "inherit" | "enabled" | "disabled";

export type ProjectSettingsForm = {
  delegatedToPortalManagers: boolean;
  browserAccess: TriState;
  bucketCreate: TriState;
  namedBucketCreate: TriState;
  accessKeyCreate: TriState;
  externalSharing: TriState;
  serverAccessLogging: TriState;
  versionCleanup: TriState;
  versioning: TriState;
  lifecycle: TriState;
  versionHistoryRetentionOverride: boolean;
  versionHistoryRetentionDays: string;
  cors: TriState;
  corsOriginsOverride: boolean;
  corsOriginsText: string;
};

export const emptyForm: ProjectSettingsForm = {
  delegatedToPortalManagers: false,
  browserAccess: "inherit",
  bucketCreate: "inherit",
  namedBucketCreate: "inherit",
  accessKeyCreate: "inherit",
  externalSharing: "inherit",
  serverAccessLogging: "inherit",
  versionCleanup: "inherit",
  versioning: "inherit",
  lifecycle: "inherit",
  versionHistoryRetentionOverride: false,
  versionHistoryRetentionDays: "",
  cors: "inherit",
  corsOriginsOverride: false,
  corsOriginsText: "",
};

function resolveTriState(value?: boolean | null): TriState {
  if (value == null) return "inherit";
  return value ? "enabled" : "disabled";
}

function toOverrideValue(value: TriState): boolean | undefined {
  if (value === "inherit") return undefined;
  return value === "enabled";
}

export function formFromSettings(
  settings: PortalProjectSettings,
): ProjectSettingsForm {
  const override = settings.project_override;
  const defaults = override.bucket_defaults;
  const effectiveDefaults = settings.effective.bucket_defaults;
  const retentionOverride =
    defaults?.noncurrent_version_expiration_days != null;
  const originsOverride = defaults?.cors_allowed_origins != null;
  return {
    delegatedToPortalManagers: settings.delegated_to_portal_managers,
    browserAccess: resolveTriState(override.browser_access_enabled),
    bucketCreate: resolveTriState(override.allow_private_storage_space_create),
    namedBucketCreate: resolveTriState(
      override.allow_portal_named_bucket_create,
    ),
    accessKeyCreate: resolveTriState(
      override.allow_portal_user_access_key_create,
    ),
    externalSharing: resolveTriState(
      override.allow_portal_user_external_sharing,
    ),
    serverAccessLogging: resolveTriState(
      override.server_access_logging_enabled,
    ),
    versionCleanup: resolveTriState(
      override.storage_space_version_cleanup_enabled,
    ),
    versioning: resolveTriState(defaults?.versioning),
    lifecycle: resolveTriState(defaults?.enable_lifecycle),
    versionHistoryRetentionOverride: retentionOverride,
    versionHistoryRetentionDays: String(
      defaults?.noncurrent_version_expiration_days ??
        effectiveDefaults.noncurrent_version_expiration_days,
    ),
    cors: resolveTriState(defaults?.enable_cors),
    corsOriginsOverride: originsOverride,
    corsOriginsText: (originsOverride
      ? (defaults?.cors_allowed_origins ?? [])
      : (effectiveDefaults.cors_allowed_origins ?? [])
    ).join("\n"),
  };
}

function buildOverride(form: ProjectSettingsForm): PortalSettingsOverride {
  const payload: PortalSettingsOverride = {};
  const directValues: Array<[keyof PortalSettingsOverride, TriState]> = [
    ["browser_access_enabled", form.browserAccess],
    ["allow_private_storage_space_create", form.bucketCreate],
    ["allow_portal_named_bucket_create", form.namedBucketCreate],
    ["allow_portal_user_access_key_create", form.accessKeyCreate],
    ["allow_portal_user_external_sharing", form.externalSharing],
    ["server_access_logging_enabled", form.serverAccessLogging],
    ["storage_space_version_cleanup_enabled", form.versionCleanup],
  ];
  directValues.forEach(([key, state]) => {
    const value = toOverrideValue(state);
    if (value !== undefined) {
      Object.assign(payload, { [key]: value });
    }
  });

  const bucketDefaults: NonNullable<PortalSettingsOverride["bucket_defaults"]> =
    {};
  const versioning = toOverrideValue(form.versioning);
  const lifecycle = toOverrideValue(form.lifecycle);
  const cors = toOverrideValue(form.cors);
  if (versioning !== undefined) bucketDefaults.versioning = versioning;
  if (lifecycle !== undefined) bucketDefaults.enable_lifecycle = lifecycle;
  if (form.versionHistoryRetentionOverride) {
    bucketDefaults.noncurrent_version_expiration_days = Number(
      form.versionHistoryRetentionDays,
    );
  }
  if (cors !== undefined) bucketDefaults.enable_cors = cors;
  if (form.corsOriginsOverride) {
    bucketDefaults.cors_allowed_origins = form.corsOriginsText
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (Object.keys(bucketDefaults).length > 0)
    payload.bucket_defaults = bucketDefaults;
  return payload;
}

export class ProjectSettingsConflict extends Error {
  constructor(public fields: string[]) {
    super("project_settings_conflict");
  }
}

export function mergeDelegation(before: boolean, desired: boolean, latest: boolean): boolean {
  // Binary changes that already match the latest value are idempotent.
  return before === desired ? latest : desired;
}

// The endpoint replaces the override. Preserve fields changed by another editor
// unless this draft also changes them; in that case require a fresh review.
export function mergeProjectOverrides(
  baseline: ProjectSettingsForm,
  draft: ProjectSettingsForm,
  latest: PortalSettingsOverride,
): PortalSettingsOverride {
  const original = buildOverride(baseline);
  const desired = buildOverride(draft);
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? undefined) === JSON.stringify(b ?? undefined);
  const conflicts: string[] = [];
  const merge = <T extends object>(before: T, after: T, current: T): T => {
    const result = { ...current };
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ]) as Set<keyof T>) {
      if (same(before[key], after[key])) continue;
      if (!same(before[key], current[key]) && !same(after[key], current[key]))
        conflicts.push(String(key));
      if (after[key] == null) delete result[key];
      else result[key] = after[key];
    }
    return result;
  };
  const { bucket_defaults: originalDefaults, ...originalFlags } = original;
  const { bucket_defaults: desiredDefaults, ...desiredFlags } = desired;
  const { bucket_defaults: latestDefaults, ...latestFlags } = latest;
  const result = merge(originalFlags, desiredFlags, latestFlags);
  const defaults = merge(
    originalDefaults ?? {},
    desiredDefaults ?? {},
    latestDefaults ?? {},
  );
  if (conflicts.length) throw new ProjectSettingsConflict(conflicts);
  return Object.keys(defaults).length
    ? { ...result, bucket_defaults: defaults }
    : result;
}
