/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { BillingStatementPdfSettings } from "../../api/appSettings";
import {
  getBillingStatementPdfSettings,
  previewBillingStatementPdf,
  updateBillingStatementPdfSettings,
} from "../../api/billing";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import {
  SettingsActions,
  SettingsButton,
  SettingsInput,
} from "../../components/settings/SettingsControls";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { extractApiError } from "../../utils/apiError";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";
const MAX_LOGO_BYTES = 512 * 1024;

function signature(settings: BillingStatementPdfSettings): string {
  return JSON.stringify(settings);
}

export default function BillingStatementPdfSettingsPanel({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { text } = useAdminI18n();
  const [draft, setDraft] = useState<BillingStatementPdfSettings | null>(null);
  const [baseline, setBaseline] = useState<BillingStatementPdfSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await getBillingStatementPdfSettings();
      setDraft(settings);
      setBaseline(settings);
    } catch (loadError) {
      setError(extractApiError(loadError, text("Unable to load Billing Statement PDF settings.")));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const validationError = useMemo(() => {
    if (!draft) return null;
    if (!draft.organization_name.trim()) return text("Organization name is required.");
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.accent_color.trim())) {
      return text("Accent color must use #rrggbb format.");
    }
    return null;
  }, [draft, text]);
  const dirty = Boolean(draft && baseline && signature(draft) !== signature(baseline));

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (!draft || validationError || isDemo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await updateBillingStatementPdfSettings(draft);
      setDraft(saved);
      setBaseline(saved);
      setMessage(text("Billing Statement PDF settings saved."));
    } catch (saveError) {
      setError(extractApiError(saveError, text("Unable to save Billing Statement PDF settings.")));
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (!draft || validationError) return;
    setPreviewing(true);
    setError(null);
    try {
      const blob = await previewBillingStatementPdf(draft);
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
    } catch (previewError) {
      setError(extractApiError(previewError, text("Unable to render Billing Statement PDF preview.")));
    } finally {
      setPreviewing(false);
    }
  };

  const chooseLogo = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError(text("Logo must be a PNG or JPEG image."));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(text("Logo must not exceed 512 KiB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError(text("Unable to read the selected logo."));
        return;
      }
      setDraft((current) => current ? { ...current, logo_data_url: reader.result as string } : current);
    };
    reader.onerror = () => setError(text("Unable to read the selected logo."));
    reader.readAsDataURL(file);
  };

  if (loading && !draft) {
    return (
      <ListPageSection
        variant="section"
        title={text("Billing Statement PDF")}
        description={text("Configure the human-readable PDF presentation of finalized Billing Statements.")}
      >
        <p className="p-4 text-sm text-[var(--ui-text-muted)]">
          {text("Loading Billing Statement PDF settings...")}
        </p>
      </ListPageSection>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsNavigationGuard
        dirty={dirty || saving}
        discardDisabled={saving}
        onDiscard={() => onDirtyChange?.(false)}
        title={text(saving ? "Operation in progress" : "Discard changes?")}
        description={text(
          saving
            ? "Wait for the operation to finish before leaving this page."
            : "Your changes have not been saved.",
        )}
        confirmLabel={text("Discard changes")}
        cancelLabel={text("Keep editing")}
      />
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <ListPageSection
        variant="section"
        title={text("Billing Statement PDF")}
        description={text("Configure the human-readable PDF presentation of finalized Billing Statements. Monetary content always comes from the immutable statement snapshot.")}
      >
        {draft && (
          <form
            className="settings-stack p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="settings-fields sm:grid-cols-2">
              <SettingsInput
                label={text("Organization name")}
                maxLength={160}
                value={draft.organization_name}
                disabled={isDemo || saving}
                onChange={(event) => setDraft((current) => current && ({
                  ...current,
                  organization_name: event.target.value,
                }))}
              />
              <SettingsInput
                label={text("Accent color")}
                maxLength={7}
                placeholder="#0569f8"
                value={draft.accent_color}
                disabled={isDemo || saving}
                error={validationError?.includes("#rrggbb") ? validationError : undefined}
                onChange={(event) => setDraft((current) => current && ({
                  ...current,
                  accent_color: event.target.value,
                }))}
              />
            </div>

            <UiTextarea
              label={text("Organization details")}
              hint={text("Optional address, department, or contact details shown below the organization name.")}
              maxLength={600}
              rows={3}
              size="compact"
              value={draft.organization_details ?? ""}
              disabled={isDemo || saving}
              onChange={(event) => setDraft((current) => current && ({
                ...current,
                organization_details: event.target.value || null,
              }))}
            />

            <div className="settings-fields sm:grid-cols-2">
              <UiInput
                label={text("Logo")}
                type="file"
                accept="image/png,image/jpeg"
                disabled={isDemo || saving}
                onChange={(event) => chooseLogo(event.target.files?.[0])}
              />
              <div className="flex items-end gap-2">
                <SettingsButton
                  type="button"
                  variant="secondary"
                  disabled={isDemo || saving || !draft.logo_data_url}
                  onClick={() => setDraft((current) => current && ({ ...current, logo_data_url: null }))}
                >
                  {text("Remove logo")}
                </SettingsButton>
                <span className="ui-caption text-[var(--ui-text-muted)]">
                  {draft.logo_data_url ? text("Logo configured") : text("No logo configured")}
                </span>
              </div>
            </div>

            <UiTextarea
              label={text("Statement note")}
              hint={text("Optional note shown before the cost detail table.")}
              maxLength={1200}
              rows={3}
              size="compact"
              value={draft.statement_note ?? ""}
              disabled={isDemo || saving}
              onChange={(event) => setDraft((current) => current && ({
                ...current,
                statement_note: event.target.value || null,
              }))}
            />

            <UiTextarea
              label={text("Footer")}
              hint={text("Optional organization footer. BucketReef always adds the non-invoice disclaimer.")}
              maxLength={500}
              rows={2}
              size="compact"
              value={draft.footer_text ?? ""}
              disabled={isDemo || saving}
              onChange={(event) => setDraft((current) => current && ({
                ...current,
                footer_text: event.target.value || null,
              }))}
            />

            {validationError && !validationError.includes("#rrggbb") && (
              <PageBanner tone="error">{validationError}</PageBanner>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <SettingsButton
                type="button"
                variant="secondary"
                loading={previewing}
                disabled={isDemo || previewing || Boolean(validationError)}
                onClick={() => void preview()}
              >
                {text("Generate preview")}
              </SettingsButton>
              <SettingsActions
                dirty={dirty}
                busy={saving}
                disabled={isDemo || Boolean(validationError)}
                onCancel={() => baseline && setDraft(baseline)}
                onSave={() => void save()}
              />
            </div>
          </form>
        )}
      </ListPageSection>

      {previewUrl && (
        <ListPageSection
          variant="section"
          title={text("Server-rendered preview")}
          description={text("This preview uses the current draft settings and the same renderer as finalized statement exports.")}
        >
          <object
            aria-label={text("Billing Statement PDF preview")}
            data={previewUrl}
            type="application/pdf"
            className="h-[70vh] min-h-[32rem] w-full border-0"
          >
            <p className="p-4 text-sm text-[var(--ui-text-muted)]">
              {text("PDF preview is not available in this browser.")}
            </p>
          </object>
        </ListPageSection>
      )}
    </div>
  );
}
