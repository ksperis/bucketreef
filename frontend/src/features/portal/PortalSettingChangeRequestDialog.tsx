/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useMemo, useState, type FormEvent } from "react";

import type { PortalProjectSettings } from "../../api/portalAccounts";
import type {
  PortalSettingChangeRequestCreate,
  PortalSettingKey,
  PortalSettingValue,
} from "../../api/portalRequests";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import { cx, uiLabelClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { PortalRequestReason } from "./PortalRequestFields";

type SettingKind = "boolean" | "retention" | "origins";
type RequestedSource = "inherit" | "enabled" | "disabled" | "custom";

type SettingOption = {
  key: PortalSettingKey;
  kind: SettingKind;
  label: string;
};

function settingKind(setting: PortalSettingKey): SettingKind {
  if (setting === "bucket_defaults.noncurrent_version_expiration_days") return "retention";
  if (setting === "bucket_defaults.cors_allowed_origins") return "origins";
  return "boolean";
}

function effectiveValue(
  settings: PortalProjectSettings,
  setting: PortalSettingKey,
): PortalSettingValue {
  const effective = settings.effective;
  if (setting === "browser_access_enabled") return effective.browser_access_enabled;
  if (setting === "allow_private_storage_space_create") return effective.allow_private_storage_space_create;
  if (setting === "allow_portal_named_bucket_create") return effective.allow_portal_named_bucket_create;
  if (setting === "allow_portal_user_access_key_create") return effective.allow_portal_user_access_key_create;
  if (setting === "allow_portal_user_external_sharing") return effective.allow_portal_user_external_sharing;
  if (setting === "server_access_logging_enabled") return effective.server_access_logging_enabled;
  if (setting === "storage_space_version_cleanup_enabled") return effective.storage_space_version_cleanup_enabled;
  if (setting === "bucket_defaults.versioning") return effective.bucket_defaults.versioning;
  if (setting === "bucket_defaults.enable_lifecycle") return effective.bucket_defaults.enable_lifecycle;
  if (setting === "bucket_defaults.enable_cors") return effective.bucket_defaults.enable_cors;
  if (setting === "bucket_defaults.noncurrent_version_expiration_days") {
    return effective.bucket_defaults.noncurrent_version_expiration_days;
  }
  return effective.bucket_defaults.cors_allowed_origins;
}

function overrideValue(
  settings: PortalProjectSettings,
  setting: PortalSettingKey,
): PortalSettingValue | undefined {
  const override = settings.project_override;
  const direct = (() => {
    if (setting === "browser_access_enabled") return override.browser_access_enabled;
    if (setting === "allow_private_storage_space_create") return override.allow_private_storage_space_create;
    if (setting === "allow_portal_named_bucket_create") return override.allow_portal_named_bucket_create;
    if (setting === "allow_portal_user_access_key_create") return override.allow_portal_user_access_key_create;
    if (setting === "allow_portal_user_external_sharing") return override.allow_portal_user_external_sharing;
    if (setting === "server_access_logging_enabled") return override.server_access_logging_enabled;
    if (setting === "storage_space_version_cleanup_enabled") return override.storage_space_version_cleanup_enabled;
    return undefined;
  })();
  if (direct != null) return direct;
  const defaults = override.bucket_defaults;
  if (setting === "bucket_defaults.versioning") return defaults?.versioning ?? undefined;
  if (setting === "bucket_defaults.enable_lifecycle") return defaults?.enable_lifecycle ?? undefined;
  if (setting === "bucket_defaults.enable_cors") return defaults?.enable_cors ?? undefined;
  if (setting === "bucket_defaults.noncurrent_version_expiration_days") {
    return defaults?.noncurrent_version_expiration_days ?? undefined;
  }
  if (setting === "bucket_defaults.cors_allowed_origins") {
    return defaults?.cors_allowed_origins ?? undefined;
  }
  return undefined;
}

function valuesEqual(left: PortalSettingValue | undefined, right: PortalSettingValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function PortalSettingChangeRequestDialog({
  settings,
  busy,
  disabled,
  error,
  onClose,
  onSubmit,
}: {
  settings: PortalProjectSettings;
  busy: boolean;
  disabled?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: PortalSettingChangeRequestCreate) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const options = useMemo<SettingOption[]>(
    () => [
      { key: "browser_access_enabled", kind: "boolean", label: t({ en: "Browser workspace access", fr: "Accès à l’espace Browser", de: "Browser-Arbeitsbereich", zh: "对象浏览工作区访问" }) },
      { key: "allow_private_storage_space_create", kind: "boolean", label: t({ en: "Private Storage Space creation", fr: "Création d’espaces privés", de: "Private Speicherbereiche erstellen", zh: "创建私有存储空间" }) },
      { key: "allow_portal_named_bucket_create", kind: "boolean", label: t({ en: "Named bucket creation", fr: "Création de buckets nommés", de: "Benannte Buckets erstellen", zh: "创建指定名称的存储桶" }) },
      { key: "allow_portal_user_access_key_create", kind: "boolean", label: t({ en: "Personal access keys", fr: "Clés d’accès personnelles", de: "Persönliche Zugriffsschlüssel", zh: "个人访问密钥" }) },
      { key: "allow_portal_user_external_sharing", kind: "boolean", label: t({ en: "External sharing by Portal users", fr: "Partage externe par les utilisateurs Portal", de: "Externe Freigabe durch Portal-Benutzer", zh: "Portal 用户外部共享" }) },
      { key: "server_access_logging_enabled", kind: "boolean", label: t({ en: "Server access logging", fr: "Journalisation des accès serveur", de: "Server-Zugriffsprotokollierung", zh: "服务器访问日志" }) },
      { key: "storage_space_version_cleanup_enabled", kind: "boolean", label: t({ en: "Storage Space history cleanup", fr: "Nettoyage de l’historique", de: "Versionsverlauf bereinigen", zh: "存储空间历史记录清理" }) },
      { key: "bucket_defaults.versioning", kind: "boolean", label: t({ en: "Versioning", fr: "Gestion des versions", de: "Versionierung", zh: "版本控制" }) },
      { key: "bucket_defaults.enable_lifecycle", kind: "boolean", label: t({ en: "Lifecycle", fr: "Cycle de vie", de: "Lebenszyklus", zh: "生命周期" }) },
      { key: "bucket_defaults.enable_cors", kind: "boolean", label: "CORS" },
      { key: "bucket_defaults.noncurrent_version_expiration_days", kind: "retention", label: t({ en: "Version history retention", fr: "Conservation de l’historique", de: "Aufbewahrung des Versionsverlaufs", zh: "版本历史保留期限" }) },
      { key: "bucket_defaults.cors_allowed_origins", kind: "origins", label: t({ en: "CORS origins", fr: "Origines CORS", de: "CORS-Ursprünge", zh: "CORS 来源" }) },
    ],
    [t],
  );
  const [setting, setSetting] = useState<PortalSettingKey>(options[0].key);
  const initialOverride = overrideValue(settings, options[0].key);
  const [requestedSource, setRequestedSource] = useState<RequestedSource>(
    initialOverride === undefined
      ? "inherit"
      : typeof initialOverride === "boolean"
        ? initialOverride ? "enabled" : "disabled"
        : "custom",
  );
  const [retentionDays, setRetentionDays] = useState(
    String(
      typeof initialOverride === "number"
        ? initialOverride
        : effectiveValue(settings, options[0].key),
    ),
  );
  const [originsText, setOriginsText] = useState(
    (Array.isArray(initialOverride)
      ? initialOverride
      : effectiveValue(settings, options[0].key)
    ) instanceof Array
      ? (Array.isArray(initialOverride)
          ? initialOverride
          : effectiveValue(settings, options[0].key) as string[]).join("\n")
      : "",
  );
  const [reason, setReason] = useState("");

  const selected = options.find((option) => option.key === setting) ?? options[0];
  const currentEffective = effectiveValue(settings, setting);
  const currentOverride = overrideValue(settings, setting);
  const parsedRetention = Number(retentionDays);
  const parsedOrigins = originsText
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedValue: PortalSettingValue | undefined =
    requestedSource === "inherit"
      ? undefined
      : requestedSource === "enabled"
        ? true
        : requestedSource === "disabled"
          ? false
          : selected.kind === "retention"
            ? parsedRetention
            : parsedOrigins;
  const invalidRetention =
    selected.kind === "retention" &&
    requestedSource === "custom" &&
    (!Number.isSafeInteger(parsedRetention) || parsedRetention < 1);
  const unchanged =
    requestedSource === "inherit"
      ? currentOverride === undefined
      : valuesEqual(currentOverride, requestedValue);

  const resetForSetting = (next: PortalSettingKey) => {
    setSetting(next);
    const nextOverride = overrideValue(settings, next);
    const nextEffective = effectiveValue(settings, next);
    const kind = settingKind(next);
    setRequestedSource(
      nextOverride === undefined
        ? "inherit"
        : typeof nextOverride === "boolean"
          ? nextOverride ? "enabled" : "disabled"
          : "custom",
    );
    if (kind === "retention") {
      setRetentionDays(String(typeof nextOverride === "number" ? nextOverride : nextEffective));
    }
    if (kind === "origins") {
      const value = Array.isArray(nextOverride) ? nextOverride : nextEffective;
      setOriginsText(Array.isArray(value) ? value.join("\n") : "");
    }
  };

  const formatValue = (value: PortalSettingValue) => {
    if (typeof value === "boolean") {
      return value
        ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert", zh: "已启用" })
        : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert", zh: "已禁用" });
    }
    if (typeof value === "number") {
      return new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long" }).format(value);
    }
    return value.length > 0
      ? value.join(", ")
      : t({ en: "No origins", fr: "Aucune origine", de: "Keine Ursprünge", zh: "无来源" });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalidRetention || unchanged || disabled) return;
    await onSubmit({
      request_type: "portal_setting_change",
      setting,
      mode: requestedSource === "inherit" ? "inherit" : "override",
      ...(requestedSource === "inherit" ? {} : { value: requestedValue }),
      reason: reason.trim() || null,
    });
  };

  return (
    <SettingsFormDialog
      title={t({ en: "Request project setting change", fr: "Demander une modification de paramètre", de: "Änderung einer Projekteinstellung anfordern", zh: "申请更改项目设置" })}
      draftKey={JSON.stringify([setting, requestedSource, retentionDays, originsText, reason])}
      busy={busy}
      disabled={Boolean(disabled) || invalidRetention || unchanged}
      error={error}
      submitLabel={t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden", zh: "发送请求" })}
      onClose={onClose}
      onSubmit={submit}
      maxWidthClass="max-w-xl"
    >
      <UiSelect
        label={t({ en: "Setting", fr: "Paramètre", de: "Einstellung", zh: "设置项" })}
        value={setting}
        onChange={(event) => resetForSetting(event.target.value as PortalSettingKey)}
        disabled={busy || disabled}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </UiSelect>

      <div className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
        <p className={uiLabelClass}>{t({ en: "Currently applied", fr: "Actuellement appliqué", de: "Derzeit angewendet", zh: "当前生效" })}</p>
        <p className={cx("mt-1 ui-body", uiTitleTextClass)}>{formatValue(currentEffective)}</p>
        <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
          {t({ en: "Source", fr: "Origine", de: "Quelle", zh: "来源" })}: {currentOverride === undefined
            ? t({ en: "Platform", fr: "Plateforme", de: "Plattform", zh: "平台" })
            : t({ en: "Project", fr: "Projet", de: "Projekt", zh: "项目" })}
        </p>
      </div>

      <UiSelect
        label={t({ en: "Requested value", fr: "Valeur demandée", de: "Gewünschter Wert", zh: "请求值" })}
        value={requestedSource}
        onChange={(event) => setRequestedSource(event.target.value as RequestedSource)}
        disabled={busy || disabled}
      >
        <option value="inherit">{t({ en: "Platform value", fr: "Valeur de la plateforme", de: "Plattformwert", zh: "平台值" })}</option>
        {selected.kind === "boolean" ? (
          <>
            <option value="enabled">{t({ en: "Enabled", fr: "Activé", de: "Aktiviert", zh: "已启用" })}</option>
            <option value="disabled">{t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert", zh: "已禁用" })}</option>
          </>
        ) : (
          <option value="custom">{t({ en: "Custom value", fr: "Valeur personnalisée", de: "Benutzerdefinierter Wert", zh: "自定义值" })}</option>
        )}
      </UiSelect>

      {selected.kind === "retention" && requestedSource === "custom" ? (
        <UiInput
          label={t({ en: "Retention days", fr: "Jours de conservation", de: "Aufbewahrungstage", zh: "保留天数" })}
          type="number"
          min={1}
          step={1}
          value={retentionDays}
          onChange={(event) => setRetentionDays(event.target.value)}
          error={invalidRetention ? t({ en: "Enter a positive whole number.", fr: "Saisissez un entier positif.", de: "Geben Sie eine positive ganze Zahl ein.", zh: "请输入正整数。" }) : undefined}
          disabled={busy || disabled}
          required
        />
      ) : null}

      {selected.kind === "origins" && requestedSource === "custom" ? (
        <UiTextarea
          label={t({ en: "CORS origins", fr: "Origines CORS", de: "CORS-Ursprünge", zh: "CORS 来源" })}
          hint={t({ en: "One origin per line.", fr: "Une origine par ligne.", de: "Ein Ursprung pro Zeile.", zh: "每行一个来源。" })}
          rows={4}
          value={originsText}
          onChange={(event) => setOriginsText(event.target.value)}
          disabled={busy || disabled}
        />
      ) : null}

      <PortalRequestReason value={reason} onChange={setReason} disabled={busy || disabled} />
    </SettingsFormDialog>
  );
}
