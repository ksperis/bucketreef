/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState } from "react";
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

export function useAppSettingsDraft(
  paths: readonly SettingsPath[],
  validate?: (values: AppSettingsValues) => FieldErrors,
  onSaved?: (settings: AppSettings) => void,
  adaptDefaults?: (
    defaults: AppSettingsValues,
    current: AppSettingsValues,
  ) => AppSettingsValues,
) {
  const { setGeneralSettings } = useGeneralSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const form = useSettingsDraft<AppSettingsValues>({});
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const conflict = useRef<AppSettings | null>(null);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
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
          setError(extractApiError(err, "Unable to load settings."));
      });
    return () => {
      cancelled = true;
    };
  }, [accept, paths]);
  const setValue = useCallback(
    (path: SettingsPath, value: DraftValue) => {
      if (!paths.includes(path))
        throw new Error("Setting is outside this page's scope.");
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
                "Changed on the server. Cancel to load the current value.",
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
      setMessage("Settings saved.");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err))
        setError(
          err instanceof SettingsConflict
            ? err.message
            : extractApiError(err, "Unable to save settings."),
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
      setError(extractApiError(err, "Unable to load default settings."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    ...form,
    settings,
    setValue,
    error,
    errors,
    message,
    busy,
    save,
    cancel,
    loadDefaults,
    verificationDialog,
  };
}
