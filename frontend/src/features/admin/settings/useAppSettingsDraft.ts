/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAppSettings,
  fetchDefaultAppSettings,
  updateAppSettings,
  type AppSettings,
} from "../../../api/appSettings";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../../auth/useRecentWebAuthnStepUp";
import { useSettingsDraft } from "../../../components/settings/useSettingsDraft";
import { extractApiError } from "../../../utils/apiError";
import { useGeneralSettings } from "../../../components/GeneralSettingsContext";
import {
  mergeSettingsChanges,
  selectSettings,
  SettingsConflict,
  type AppSettingsValues,
  type DraftValue,
  type FieldErrors,
  type SettingsPath,
} from "./appSettingsDraft";
import { appSettingsSource, useAppSettingsI18n } from "./appSettingsMessage";

type SettingsError =
  | { key: "settingsConflict" }
  | { cause: unknown; fallback: "loadError" | "saveError" | "defaultsError" };
type SettingsFieldErrors = Partial<Record<SettingsPath, string | { key: "fieldConflict" }>>;

export function useAppSettingsDraft(
  paths: readonly SettingsPath[],
  validate?: (values: AppSettingsValues) => FieldErrors,
  onSaved?: (settings: AppSettings) => void,
  adaptDefaults?: (
    defaults: AppSettingsValues,
    current: AppSettingsValues,
  ) => AppSettingsValues,
) {
  const { text } = useAppSettingsI18n();
  const { setGeneralSettings } = useGeneralSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const form = useSettingsDraft<AppSettingsValues>({});
  const [error, setError] = useState<SettingsError | null>(null);
  const [errors, setErrors] = useState<SettingsFieldErrors>({});
  const [message, setMessage] = useState<"saved" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const conflict = useRef<AppSettings | null>(null);
  const verificationLabels = useMemo(() => ({
    title: text("verifyPasskey"),
    description: text("verificationDescription"),
    cancel: text("cancel"),
    close: text("close"),
    cancelled: text("verificationCancelled"),
    failure: (err: unknown) => extractApiError(err, text("verificationFailed")),
  }), [text]);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(verificationLabels);
  const { accept, setDraft } = form;
  useEffect(() => {
    let cancelled = false;
    fetchAppSettings()
      .then((data) => {
        if (!cancelled) {
          setSettings(data);
          accept(selectSettings(data, paths));
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError({ cause: err, fallback: "loadError" });
      });
    return () => {
      cancelled = true;
    };
  }, [accept, paths]);
  const setValue = useCallback(
    (path: SettingsPath, value: DraftValue) => {
      if (!paths.includes(path))
        throw new Error(appSettingsSource("scopeError"));
      setDraft((current) => ({ ...current, [path]: value }));
      setErrors((current) => ({ ...current, [path]: undefined }));
      setMessage(null);
    },
    [setDraft, paths],
  );
  const cancel = () => {
    const current = conflict.current ?? settings;
    if (current) {
      setSettings(current);
      accept(selectSettings(current, paths));
    }
    conflict.current = null;
    setError(null);
    setErrors({});
    setMessage(null);
  };
  const save = async () => {
    if (!settings || pending.current || !form.dirty) return;
    const fieldErrors = validate?.(form.draft) ?? {};
    setErrors(fieldErrors);
    if (Object.values(fieldErrors).some(Boolean)) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const latest = await fetchAppSettings();
      let payload: AppSettings;
      try {
        payload = mergeSettingsChanges(settings, latest, form.draft, paths);
      } catch (err) {
        if (err instanceof SettingsConflict) {
          conflict.current = latest;
          setErrors(
            Object.fromEntries(
              err.fields.map((path) => [
                path,
                { key: "fieldConflict" },
              ]),
            ),
          );
        }
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        );
        throw err;
      }
      const saved = await runWithStepUp(() => updateAppSettings(payload));
      setSettings(saved);
      accept(selectSettings(saved, paths));
      conflict.current = null;
      setGeneralSettings(saved.general);
      onSaved?.(saved);
      setMessage("saved");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err))
        setError(
          err instanceof SettingsConflict
            ? { key: "settingsConflict" }
            : { cause: err, fallback: "saveError" },
        );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const loadDefaults = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      const selectedDefaults = selectSettings(defaults, paths);
      setDraft(
        (current) =>
          adaptDefaults?.(selectedDefaults, current) ?? selectedDefaults,
      );
      setErrors({});
    } catch (err) {
      setError({ cause: err, fallback: "defaultsError" });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    const latest = await fetchAppSettings();
    const oldValues = settings ? selectSettings(settings, paths) : {};
    const pendingChanges = Object.fromEntries(Object.entries(form.draft).filter(([key, value]) => value !== oldValues[key as SettingsPath]));
    const next = selectSettings(latest, paths);
    setSettings(latest);
    accept(next);
    setDraft({ ...next, ...pendingChanges });
    setGeneralSettings(latest.general);
  };
  return {
    ...form,
    settings,
    setValue,
    error: error && ("key" in error ? text(error.key) : extractApiError(error.cause, text(error.fallback))),
    errors: Object.fromEntries(
      Object.entries(errors).map(([path, value]) => [path, typeof value === "object" ? text(value.key) : value]),
    ) as FieldErrors,
    message: message && text(message),
    busy,
    save,
    cancel,
    loadDefaults,
    refresh,
    verificationDialog,
  };
}
