/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchGeneralFeatureLocks,
  sendQuotaNotificationTestEmail,
  type GeneralFeatureLocks,
  type QuotaNotificationSettings,
} from "../../api/appSettings";
import { resumeOnboarding } from "../../api/onboarding";
import { applyBranding } from "../../components/ui/brandingRuntime";
import {
  SettingsItem,
  SettingsSection,
  SettingsSwitch,
} from "../../components/settings/SettingsLayout";
import {
  SettingsButton,
  SettingsField,
} from "../../components/settings/SettingsControls";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import AdminSettingsFrame from "./settings/AdminSettingsFrame";
import BrandingPreview from "./settings/BrandingPreview";
import {
  AppSettingsNumber,
  AppSettingsToggle,
} from "./settings/AppSettingsFields";
import { useAppSettingsDraft } from "./settings/useAppSettingsDraft";
import { useOnboardingStatus } from "./useOnboardingStatus";
import {
  validateInteger,
  type AppSettingsValues,
  type FieldErrors,
  type SettingsPath,
} from "./settings/appSettingsDraft";

const featureFields = [
  "manager_enabled",
  "browser_enabled",
  "portal_enabled",
  "ceph_admin_enabled",
  "storage_ops_enabled",
  "billing_enabled",
  "endpoint_status_enabled",
] as const;
const smtpFields = [
  { key: "smtp_host", label: "SMTP host" },
  { key: "smtp_port", label: "SMTP port", max: 65535 },
  { key: "smtp_username", label: "SMTP username" },
  { key: "smtp_from_email", label: "SMTP from email" },
  { key: "smtp_from_name", label: "SMTP from name" },
  { key: "smtp_timeout_seconds", label: "SMTP timeout (seconds)", max: 300 },
] as const;
const paths = [
  ...featureFields.map((field) => `general.${field}` as const),
  "general.quota_alerts_enabled",
  "general.usage_history_enabled",
  "quota_notifications.threshold_percent",
  "quota_notifications.include_subject_contact_email",
  ...smtpFields.map((field) => `quota_notifications.${field.key}` as const),
  "quota_notifications.smtp_starttls",
  "branding.primary_color",
  "branding.login_logo_url",
] as const satisfies readonly SettingsPath[];
const colors = [
  "#0569f8",
  "#2563eb",
  "#0f766e",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#be123c",
  "#7c3aed",
];
function validLogo(value: string) {
  if (!value || value.startsWith("/") || value.startsWith("data:image/"))
    return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function validateSmtp(values: AppSettingsValues): FieldErrors {
  return {
    "quota_notifications.smtp_port": validateInteger(
      values["quota_notifications.smtp_port"],
      "SMTP port",
      1,
      65535,
    ),
    "quota_notifications.smtp_timeout_seconds": validateInteger(
      values["quota_notifications.smtp_timeout_seconds"],
      "SMTP timeout",
      1,
      300,
    ),
  };
}
function validate(values: AppSettingsValues): FieldErrors {
  return {
    ...validateSmtp(values),
    "quota_notifications.threshold_percent": validateInteger(
      values["quota_notifications.threshold_percent"],
      "Threshold percent",
      1,
      100,
    ),
    "branding.primary_color": /^#[0-9a-f]{6}$/i.test(
      String(values["branding.primary_color"]),
    )
      ? undefined
      : "Choose a valid color.",
    "branding.login_logo_url": validLogo(
      String(values["branding.login_logo_url"] ?? "").trim(),
    )
      ? undefined
      : "Use an HTTP(S), relative, or image data URL.",
  };
}

export default function GeneralSettingsPage() {
  const navigate = useNavigate();
  const { status: onboardingStatus } = useOnboardingStatus();
  const [locks, setLocks] = useState<GeneralFeatureLocks | null>(null);
  const form = useAppSettingsDraft(
    paths,
    validate,
    (saved) => applyBranding(saved.branding.primary_color),
    (defaults, current) => ({
      ...defaults,
      ...Object.fromEntries(
        featureFields
          .filter((field) => !locks || locks[field]?.forced)
          .map((field) => [`general.${field}`, current[`general.${field}`]]),
      ),
    }),
  );
  const [lockError, setLockError] = useState<string | null>(null);
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchGeneralFeatureLocks()
      .then((value) => {
        if (active) setLocks(value);
      })
      .catch((err) => {
        if (active)
          setLockError(
            extractApiError(err, "Unable to load environment locks."),
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const feature = (
    key: (typeof featureFields)[number],
    title: string,
    description: string,
    experimental = false,
  ) => {
    const lock = locks?.[key];
    return (
      <AppSettingsToggle
        key={key}
        form={form}
        field={`general.${key}`}
        title={title}
        ariaLabel={`${title} feature`}
        disabled={!locks || lock?.forced}
        experimental={experimental}
        description={
          <>
            {description}
            {lock?.forced && (
              <span className="block">
                Forced by environment ({lock.source ? `${lock.source}=` : ""}
                {String(lock.value)}).
              </span>
            )}
          </>
        }
      />
    );
  };
  const testSmtp = async (values: AppSettingsValues) => {
    if (sending || Object.values(validateSmtp(values)).some(Boolean)) return;
    setSending(true);
    setTestError(null);
    setTestMessage(null);
    const settings: QuotaNotificationSettings = {
      threshold_percent: Number(
        form.draft["quota_notifications.threshold_percent"],
      ),
      include_subject_contact_email: Boolean(
        form.draft["quota_notifications.include_subject_contact_email"],
      ),
      smtp_host: String(values["quota_notifications.smtp_host"] ?? "") || null,
      smtp_port: Number(values["quota_notifications.smtp_port"]),
      smtp_username:
        String(values["quota_notifications.smtp_username"] ?? "") || null,
      smtp_from_email:
        String(values["quota_notifications.smtp_from_email"] ?? "") || null,
      smtp_from_name:
        String(values["quota_notifications.smtp_from_name"] ?? "") || null,
      smtp_starttls: Boolean(values["quota_notifications.smtp_starttls"]),
      smtp_timeout_seconds: Number(
        values["quota_notifications.smtp_timeout_seconds"],
      ),
    };
    try {
      const result = await sendQuotaNotificationTestEmail(settings);
      setTestMessage(`Test email sent to ${result.recipient}.`);
    } catch (err) {
      setTestError(extractApiError(err, "Unable to send test email."));
    } finally {
      setSending(false);
    }
  };
  const openOnboarding = async () => {
    if (!onboardingStatus || onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError(null);
    try {
      if (onboardingStatus.dismissed) await resumeOnboarding();
      navigate("/admin/onboarding");
    } catch (err) {
      setOnboardingError(extractApiError(err, "Unable to open the setup assistant."));
    } finally {
      setOnboardingBusy(false);
    }
  };
  const color = String(form.draft["branding.primary_color"] ?? "#0569f8");
  return (
    <AdminSettingsFrame
      title="General settings"
      description="Workspace availability, platform services and branding."
      page="general-settings"
      resetTitle="Reset general settings draft?"
      form={form}
      dialogDirty={dialogDirty}
      dialogs={
        smtpOpen && (
          <SettingsDraftDialog
            title="Email delivery"
            maxWidthClass="max-w-xl"
            initialValue={{ ...form.draft }}
            validate={validateSmtp}
            onDirtyChange={setDialogDirty}
            onClose={() => setSmtpOpen(false)}
            onApply={(values) => {
              for (const field of smtpFields)
                form.setValue(
                  `quota_notifications.${field.key}`,
                  values[`quota_notifications.${field.key}`],
                );
              form.setValue(
                "quota_notifications.smtp_starttls",
                values["quota_notifications.smtp_starttls"],
              );
            }}
          >
            {(values, setValues, errors, validateDraft) => (
              <>
                {smtpFields.map((field) => {
                  const path = `quota_notifications.${field.key}` as const;
                  return (
                    <label key={path}>
                      <span>{field.label}</span>
                      <SettingsField
                        label={field.label}
                        type={"max" in field ? "number" : "text"}
                        min={1}
                        max={"max" in field ? field.max : undefined}
                        value={String(values[path] ?? "")}
                        error={errors[path]}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [path]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  );
                })}
                <div className="flex items-center justify-between gap-3">
                  <span>SMTP STARTTLS</span>
                  <SettingsSwitch
                    ariaLabel="SMTP STARTTLS"
                    checked={Boolean(
                      values["quota_notifications.smtp_starttls"],
                    )}
                    onChange={(value) =>
                      setValues((current) => ({
                        ...current,
                        "quota_notifications.smtp_starttls": value,
                      }))
                    }
                  />
                </div>
                <p className="text-xs text-[var(--ui-text-muted)]">
                  SMTP_PASSWORD is managed by the environment. A test uses this
                  draft without saving it.
                </p>
                <SettingsButton
                  variant="secondary"
                  disabled={sending}
                  onClick={() => {
                    if (validateDraft()) void testSmtp(values);
                  }}
                >
                  {sending ? "Sending..." : "Send test email"}
                </SettingsButton>
                {testError && (
                  <UiInlineMessage tone="error">{testError}</UiInlineMessage>
                )}
                {testMessage && <p role="status">{testMessage}</p>}
              </>
            )}
          </SettingsDraftDialog>
        )
      }
    >
      {lockError && <UiInlineMessage tone="error">{lockError}</UiInlineMessage>}
      <SettingsSection
        presentation="compact"
        title="Setup assistant"
        description="Return to the guided setup whenever you need it."
      >
        <SettingsItem
          compact
          title="Guided setup"
          description={
            !onboardingStatus
              ? "Loading setup status…"
              : onboardingStatus.complete
                ? "Initial setup is complete. Run the assistant again to prepare another endpoint or access path."
                : onboardingStatus.dismissed
                  ? "The assistant is hidden. You can show it again without changing the current configuration."
                  : "Connect storage, choose Manager, Portal, private Browser access, monitoring or Ceph Admin, then provide only the required credentials."
          }
          action={
            <SettingsButton
              variant="secondary"
              disabled={!onboardingStatus || onboardingBusy}
              onClick={() => void openOnboarding()}
            >
              {onboardingBusy
                ? "Opening…"
                : onboardingStatus?.complete
                  ? "Run setup assistant again"
                  : onboardingStatus?.dismissed
                    ? "Show setup assistant"
                    : "Open setup assistant"}
            </SettingsButton>
          }
        />
        {onboardingError && <UiInlineMessage tone="error">{onboardingError}</UiInlineMessage>}
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Available workspaces"
        description="Availability does not grant storage permissions."
      >
        {feature(
          "manager_enabled",
          "Manager",
          "Storage administration workspace.",
        )}
        {feature(
          "browser_enabled",
          "Browser",
          "Object and bucket exploration.",
        )}
        {feature(
          "portal_enabled",
          "Portal",
          "Self-service Storage Spaces, governed by project roles.",
          true,
        )}
        {feature(
          "ceph_admin_enabled",
          "Ceph Admin",
          "Advanced cluster-wide operations. Avoid enabling this surface on an instance exposed to end users.",
        )}
        {feature(
          "storage_ops_enabled",
          "Storage Ops",
          "Cross-account and cross-connection bucket operations.",
        )}
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Services and monitoring"
        description="Optional platform capabilities."
      >
        {feature(
          "billing_enabled",
          "Billing",
          form.draft["general.billing_enabled"]
            ? "Billing dashboards. Enable the billing collection cron job separately."
            : "Billing dashboards.",
        )}
        {feature(
          "endpoint_status_enabled",
          "Endpoint Status",
          "Endpoint healthchecks.",
        )}
        <AppSettingsToggle
          form={form}
          field="general.usage_history_enabled"
          title="Usage history"
          ariaLabel="Usage history feature"
          description="Collect usage snapshots for historical metrics."
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Quota alerts"
        description="Email notifications for S3 Accounts and S3 Users."
      >
        <AppSettingsToggle
          form={form}
          field="general.quota_alerts_enabled"
          title="Quota alerts"
          ariaLabel="Quota alerts feature"
        />
        <AppSettingsNumber
          form={form}
          field="quota_notifications.threshold_percent"
          title="Threshold percent"
          min={1}
          max={100}
          description="Full-quota alerts are always sent at 100%."
        />
        <AppSettingsToggle
          form={form}
          field="quota_notifications.include_subject_contact_email"
          title="Include subject contact email"
          description="Also notify the account or S3 user's contact address when defined."
        />
        <SettingsItem
          compact
          title="Email delivery"
          description={
            form.draft["quota_notifications.smtp_host"]
              ? `${form.draft["quota_notifications.smtp_host"]}:${form.draft["quota_notifications.smtp_port"]}`
              : "SMTP is not configured."
          }
          action={
            <SettingsButton
              variant="secondary"
              onClick={() => {
                setTestError(null);
                setTestMessage(null);
                setSmtpOpen(true);
              }}
            >
              Configure SMTP
            </SettingsButton>
          }
        />
      </SettingsSection>
      <SettingsSection
        presentation="compact"
        title="Branding"
        description="Preview your changes here. The application updates after saving."
      >
        <SettingsItem
          compact
          title="Primary accent color"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {colors.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="h-11 w-11 lg:h-8 lg:w-8 rounded border border-[var(--ui-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  style={{ backgroundColor: value }}
                  aria-label={`Use preset color ${value}`}
                  onClick={() => form.setValue("branding.primary_color", value)}
                />
              ))}
              <SettingsField
                label="Primary color picker"
                type="color"
                value={color}
                onChange={(event) =>
                  form.setValue("branding.primary_color", event.target.value)
                }
                error={form.errors["branding.primary_color"]}
                className="w-12"
              />
            </div>
          }
        />
        <SettingsItem
          compact
          title="Login logo"
          description="Leave empty to use the default logo. BucketReef branding always remains visible."
          action={
            <SettingsField
              label="Login logo URL"
              value={String(form.draft["branding.login_logo_url"] ?? "")}
              onChange={(event) =>
                form.setValue("branding.login_logo_url", event.target.value)
              }
              error={form.errors["branding.login_logo_url"]}
              className="w-80"
            />
          }
        />
        <div className="py-3">
          <BrandingPreview color={color} />
        </div>
      </SettingsSection>
    </AdminSettingsFrame>
  );
}
