/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { AppSettings } from "../../../api/appSettings";
import { equalSettings } from "../../../components/settings/useSettingsDraft";

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends unknown[]
    ? K
    : T[K] extends object
      ? `${K}.${LeafPaths<T[K]>}`
      : K;
}[keyof T & string];
export type SettingsPath = LeafPaths<AppSettings>;
export type DraftValue = string | boolean | string[] | null | undefined;
export type AppSettingsValues = Partial<Record<SettingsPath, DraftValue>>;
export type FieldErrors = Partial<Record<SettingsPath, string>>;

function read(settings: AppSettings, path: SettingsPath): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      settings,
    );
}

function write(settings: AppSettings, path: SettingsPath, value: unknown) {
  const parts = path.split(".");
  let target = settings as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (!target[part]) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

export function selectSettings(
  settings: AppSettings,
  paths: readonly SettingsPath[],
): AppSettingsValues {
  return Object.fromEntries(
    paths.map((path) => {
      const value = read(settings, path);
      return [path, typeof value === "number" ? String(value) : value];
    }),
  );
}

export class SettingsConflict extends Error {
  constructor(public fields: SettingsPath[]) {
    super(
      "These settings changed on the server. Cancel to load their current values, or review your changes before trying again.",
    );
  }
}

export function mergeSettingsChanges(
  baseline: AppSettings,
  latest: AppSettings,
  draft: AppSettingsValues,
  paths: readonly SettingsPath[],
): AppSettings {
  const result = structuredClone(latest);
  const original = selectSettings(baseline, paths);
  const conflicts: SettingsPath[] = [];
  for (const path of paths) {
    if (equalSettings(original[path], draft[path])) continue;
    const oldValue = read(baseline, path);
    const currentValue = read(latest, path);
    const raw = draft[path];
    const value =
      typeof oldValue === "number"
        ? Number(raw)
        : oldValue === null && raw === ""
          ? null
          : raw;
    if (
      !equalSettings(oldValue, currentValue) &&
      !equalSettings(currentValue, value)
    )
      conflicts.push(path);
    write(result, path, value);
  }
  if (conflicts.length) throw new SettingsConflict(conflicts);
  return result;
}

export function validateInteger(
  value: DraftValue,
  label: string,
  min: number,
  max?: number,
): string | undefined {
  const number = Number(value);
  if (
    value === "" ||
    value == null ||
    !Number.isSafeInteger(number) ||
    number < min ||
    (max !== undefined && number > max)
  )
    return `${label} must be a whole number ${max === undefined ? `of at least ${min}` : `between ${min} and ${max}`}.`;
}
