/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useMemo, useState } from "react";

import {
  fetchCostSettings,
  updateCostSettings,
  type CostEndpointOverride,
  type CostGlobalModel,
  type CostRateValues,
  type CostSettings,
} from "../../api/cost";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import PageShell from "../../components/PageShell";
import {
  SettingsActions,
  SettingsButton,
  SettingsField,
} from "../../components/settings/SettingsControls";
import { SettingsItem, SettingsSection } from "../../components/settings/SettingsLayout";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiBadge from "../../components/ui/UiBadge";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";

type EditableRateValues = Record<keyof CostRateValues, string>;
type EditableGlobalModel = EditableRateValues & { currency: string };
type EditableEndpointOverride = EditableRateValues & { storage_endpoint_id: number };
type EditableCostSettings = {
  model: EditableGlobalModel | null;
  endpoint_overrides: EditableEndpointOverride[];
};

const rateFields: Array<{ key: keyof CostRateValues; label: string; unit: string }> = [
  { key: "storage_gb_month_price", label: "Storage", unit: "/ GB-month" },
  { key: "egress_gb_price", label: "Egress", unit: "/ GB" },
  { key: "ingress_gb_price", label: "Ingress", unit: "/ GB" },
  { key: "requests_per_1000_price", label: "Requests", unit: "/ 1,000" },
];

const zeroRates = (): EditableRateValues => ({
  storage_gb_month_price: "0",
  egress_gb_price: "0",
  ingress_gb_price: "0",
  requests_per_1000_price: "0",
});

function cloneEditableRates(values: EditableRateValues): EditableRateValues {
  return {
    storage_gb_month_price: values.storage_gb_month_price,
    egress_gb_price: values.egress_gb_price,
    ingress_gb_price: values.ingress_gb_price,
    requests_per_1000_price: values.requests_per_1000_price,
  };
}

function editableRates(values: CostRateValues): EditableRateValues {
  return {
    storage_gb_month_price: String(values.storage_gb_month_price),
    egress_gb_price: String(values.egress_gb_price),
    ingress_gb_price: String(values.ingress_gb_price),
    requests_per_1000_price: String(values.requests_per_1000_price),
  };
}

function toEditable(settings: CostSettings): EditableCostSettings {
  return {
    model: settings.model
      ? { currency: settings.model.currency, ...editableRates(settings.model) }
      : null,
    endpoint_overrides: settings.endpoint_overrides.map((item) => ({
      storage_endpoint_id: item.storage_endpoint_id,
      ...editableRates(item),
    })),
  };
}

function parseRate(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function payloadRates(values: EditableRateValues): CostRateValues | null {
  const storage = parseRate(values.storage_gb_month_price);
  const egress = parseRate(values.egress_gb_price);
  const ingress = parseRate(values.ingress_gb_price);
  const requests = parseRate(values.requests_per_1000_price);
  if ([storage, egress, ingress, requests].some((value) => value === null)) return null;
  return {
    storage_gb_month_price: storage!,
    egress_gb_price: egress!,
    ingress_gb_price: ingress!,
    requests_per_1000_price: requests!,
  };
}

function toPayload(draft: EditableCostSettings): CostSettings | null {
  if (!draft.model) return { model: null, endpoint_overrides: [] };
  const globalRates = payloadRates(draft.model);
  if (!globalRates || !/^[A-Z]{3}$/.test(draft.model.currency.trim().toUpperCase())) return null;
  const endpointOverrides: CostEndpointOverride[] = [];
  for (const item of draft.endpoint_overrides) {
    const rates = payloadRates(item);
    if (!rates) return null;
    endpointOverrides.push({ storage_endpoint_id: item.storage_endpoint_id, ...rates });
  }
  const model: CostGlobalModel = {
    currency: draft.model.currency.trim().toUpperCase(),
    ...globalRates,
  };
  return { model, endpoint_overrides: endpointOverrides };
}

export default function CostSettingsPage() {
  const { text } = useAdminI18n();
  const form = useSettingsDraft<EditableCostSettings>({ model: null, endpoint_overrides: [] });
  const acceptSettings = form.accept;
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCostSettings(), listStorageEndpoints()])
      .then(([settings, storageEndpoints]) => {
        if (cancelled) return;
        acceptSettings(toEditable(settings));
        setEndpoints(storageEndpoints);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err, text("Unable to load Cost settings.")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [acceptSettings, text]);

  const overrides = useMemo(
    () => new Map(form.draft.endpoint_overrides.map((item) => [item.storage_endpoint_id, item])),
    [form.draft.endpoint_overrides],
  );

  const updateGlobal = (field: keyof EditableGlobalModel, value: string) => {
    form.setDraft((current) => current.model
      ? { ...current, model: { ...current.model, [field]: value } }
      : current);
    setValidationError(null);
    setMessage(null);
  };

  const updateOverride = (endpointId: number, field: keyof EditableRateValues, value: string) => {
    form.setDraft((current) => ({
      ...current,
      endpoint_overrides: current.endpoint_overrides.map((item) =>
        item.storage_endpoint_id === endpointId ? { ...item, [field]: value } : item),
    }));
    setValidationError(null);
    setMessage(null);
  };

  const enableOverride = (endpointId: number) => {
    if (!form.draft.model || overrides.has(endpointId)) return;
    form.setDraft((current) => ({
      ...current,
      endpoint_overrides: [
        ...current.endpoint_overrides,
        { storage_endpoint_id: endpointId, ...cloneEditableRates(current.model!) },
      ].sort((left, right) => left.storage_endpoint_id - right.storage_endpoint_id),
    }));
    setMessage(null);
  };

  const disableOverride = (endpointId: number) => {
    form.setDraft((current) => ({
      ...current,
      endpoint_overrides: current.endpoint_overrides.filter((item) => item.storage_endpoint_id !== endpointId),
    }));
    setMessage(null);
  };

  const save = async () => {
    const payload = toPayload(form.draft);
    if (!payload) {
      setValidationError(text("Currency must use three letters and every price must be zero or greater."));
      return;
    }
    setBusy(true);
    setError(null);
    setValidationError(null);
    setMessage(null);
    try {
      const saved = await updateCostSettings(payload);
      form.accept(toEditable(saved));
      setMessage(text("Cost settings saved."));
    } catch (err) {
      setError(extractApiError(err, text("Unable to save Cost settings.")));
    } finally {
      setBusy(false);
    }
  };

  const currency = form.draft.model?.currency.trim().toUpperCase() || "EUR";

  return (
    <PageShell
      title={text("Cost settings")}
      description={text("Configure the global cost model and complete per-endpoint overrides.")}
      breadcrumbs={adminPageBreadcrumbs("cost-settings")}
      rightContent={
        <SettingsButton
          variant="ghost"
          disabled={isDemo || busy || !form.draft.model}
          onClick={() => {
            form.setDraft({ model: null, endpoint_overrides: [] });
            setMessage(null);
          }}
        >
          {text("Reset configuration")}
        </SettingsButton>
      }
    >
      <div className="settings-compact">
        {isDemo && <UiInlineMessage tone="info">{text("Settings are read-only in the static demo.")}</UiInlineMessage>}
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        {validationError && <UiInlineMessage tone="error">{validationError}</UiInlineMessage>}
        {message && <UiInlineMessage tone="success">{message}</UiInlineMessage>}
        {loading ? (
          <p role="status">{text("Loading Cost settings...")}</p>
        ) : (
          <>
            <SettingsSection
              presentation="compact"
              title={text("Global cost model")}
              description={text("All endpoints use these rates unless a complete endpoint override is configured.")}
            >
              {!form.draft.model ? (
                <SettingsItem
                  compact
                  title={text("No cost model configured")}
                  description={text("Usage remains available, but estimated costs are unavailable until a model is configured.")}
                  action={
                    <SettingsButton
                      disabled={isDemo || busy}
                      onClick={() => form.setDraft({ model: { currency: "EUR", ...zeroRates() }, endpoint_overrides: [] })}
                    >
                      {text("Configure model")}
                    </SettingsButton>
                  }
                />
              ) : (
                <>
                  <SettingsItem compact title={text("Currency")} description={text("One currency is shared by the global model and every endpoint override.")}>
                    <SettingsField
                      label={text("Currency")}
                      value={form.draft.model.currency}
                      maxLength={3}
                      disabled={isDemo || busy}
                      onChange={(event) => updateGlobal("currency", event.target.value.toUpperCase())}
                    />
                  </SettingsItem>
                  <SettingsItem compact title={text("Rates")} description={text("Unit prices used to estimate storage, transfer, and request costs.")}>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {rateFields.map((field) => (
                        <SettingsField
                          key={field.key}
                          label={text(field.label)}
                          type="number"
                          min={0}
                          step="0.000001"
                          value={form.draft.model![field.key]}
                          unit={`${currency} ${field.unit}`}
                          disabled={isDemo || busy}
                          onChange={(event) => updateGlobal(field.key, event.target.value)}
                        />
                      ))}
                    </div>
                  </SettingsItem>
                </>
              )}
            </SettingsSection>

            <SettingsSection
              presentation="compact"
              title={text("Endpoint overrides")}
              description={text("An override replaces all global rates for its endpoint. Removing it restores the global model.")}
            >
              {endpoints.length === 0 ? (
                <p>{text("No storage endpoint is configured.")}</p>
              ) : endpoints.map((endpoint) => {
                const override = overrides.get(endpoint.id);
                return (
                  <SettingsItem
                    key={endpoint.id}
                    compact
                    title={endpoint.name}
                    description={endpoint.endpoint_url}
                    status={<UiBadge tone={override ? "warning" : "neutral"}>{override ? text("Override") : text("Global")}</UiBadge>}
                    action={form.draft.model ? (
                      <SettingsButton
                        variant="secondary"
                        disabled={isDemo || busy}
                        onClick={() => override ? disableOverride(endpoint.id) : enableOverride(endpoint.id)}
                      >
                        {override ? text("Use global") : text("Add override")}
                      </SettingsButton>
                    ) : undefined}
                  >
                    {override && (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {rateFields.map((field) => (
                          <SettingsField
                            key={field.key}
                            label={text(field.label)}
                            type="number"
                            min={0}
                            step="0.000001"
                            value={override[field.key]}
                            unit={`${currency} ${field.unit}`}
                            disabled={isDemo || busy}
                            onChange={(event) => updateOverride(endpoint.id, field.key, event.target.value)}
                          />
                        ))}
                      </div>
                    )}
                  </SettingsItem>
                );
              })}
            </SettingsSection>
          </>
        )}

        <SettingsActions
          disabled={isDemo}
          dirty={form.dirty}
          busy={busy}
          onSave={() => void save()}
          onCancel={() => {
            form.cancel();
            setValidationError(null);
            setMessage(null);
          }}
        />
        <SettingsNavigationGuard dirty={form.dirty} onDiscard={form.cancel} discardDisabled={busy} />
      </div>
    </PageShell>
  );
}
