/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useId, useState } from "react";
import { getTopicConfiguration, updateTopicConfiguration, type Topic } from "../../api/topics";
import type { S3AccountSelector } from "../../api/accountParams";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { createUiDraftId } from "../../utils/uiDraftId";
import { extractApiError } from "../../utils/apiError";
import { useTopicEditorDraft } from "./useTopicEditorDraft";
import { equalSettings } from "../../components/settings/useSettingsDraft";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

type AttributeDraft = {
  uiId: string;
  key: string;
  value: string;
};

const PRIMARY_ATTRIBUTE_KEYS = new Set(["push-endpoint", "verify-ssl"]);

const formatAttributeValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseAttributeValue = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: "" };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { value: JSON.parse(trimmed) };
    } catch {
      return { value: null, error: "JSON values must be valid objects or arrays." };
    }
  }
  return { value: raw };
};

const buildAttributeDrafts = (configuration: Record<string, unknown> | null | undefined): AttributeDraft[] => {
  return Object.entries(configuration ?? {})
    .filter(([key]) => !PRIMARY_ATTRIBUTE_KEYS.has(key))
    .map(([key, value]) => ({ uiId: createUiDraftId("topic-attribute"), key, value: formatAttributeValue(value) }));
};

const readPushEndpointValue = (configuration: Record<string, unknown> | null | undefined): string => {
  const value = configuration?.["push-endpoint"];
  return typeof value === "string" ? value : "";
};

const readVerifySslValue = (configuration: Record<string, unknown> | null | undefined): boolean => {
  const value = configuration?.["verify-ssl"];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
  }
  return true;
};

const configurationDraft = (configuration: Record<string, unknown> | null) => ({
  pushEndpointValue: readPushEndpointValue(configuration),
  verifySslValue: readVerifySslValue(configuration),
  attributeItems: buildAttributeDrafts(configuration),
});

const editableValues = ({ attributeItems, ...delivery }: ReturnType<typeof configurationDraft>) => ({
  ...delivery,
  attributeItems: attributeItems.map(({ key, value }) => ({ key, value })),
});

export default function TopicAttributesEditor({ accountId, currentAccountId, topic, onSaved, onClose }: {
  accountId: S3AccountSelector;
  currentAccountId: S3AccountSelector;
  topic: Topic;
  onSaved: (configuration: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const sslHintId = useId();
  const load = useCallback(async () => configurationDraft((await getTopicConfiguration(accountId, topic.arn)).configuration ?? {}), [accountId, topic.arn]);
  const { draft, baseline, setDraft, accept, loading, loadError, retry } = useTopicEditorDraft(() => configurationDraft(topic.configuration), load);
  const dirty = !equalSettings(editableValues(baseline), editableValues(draft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fieldsDisabled = loading || saving || Boolean(loadError);
  useEffect(() => {
    if (currentAccountId !== accountId && !dirty && !saving) onClose();
  }, [accountId, currentAccountId, dirty, onClose, saving]);
  const updateItem = (uiId: string, patch: Partial<AttributeDraft>) => {
    setError(null); setStatus(null);
    setDraft(value => ({ ...value, attributeItems: value.attributeItems.map(item => item.uiId === uiId ? { ...item, ...patch } : item) }));
  };
  const handleAttributeKeyChange = (id: string, value: string) => updateItem(id, { key: value });
  const handleAttributeValueChange = (id: string, value: string) => updateItem(id, { value });
  const handleAddAttribute = () => {
    setError(null); setStatus(null);
    setDraft(value => ({ ...value, attributeItems: [...value.attributeItems, { uiId: createUiDraftId("topic-attribute"), key: "", value: "" }] }));
  };
  const handleRemoveAttribute = (id: string) => {
    setError(null); setStatus(null);
    setDraft(value => ({ ...value, attributeItems: value.attributeItems.filter(item => item.uiId !== id) }));
  };
  const save = async () => {
    if (fieldsDisabled) return;
    setError(null); setStatus(null);
    const configuration: Record<string, unknown> = {};
    const trimmedEndpoint = draft.pushEndpointValue.trim();
    if (trimmedEndpoint) {
      configuration["push-endpoint"] = trimmedEndpoint;
    }
    if (!draft.verifySslValue) {
      configuration["verify-ssl"] = false;
    }

    const seenKeys = new Set<string>();
    for (const item of draft.attributeItems) {
      const key = item.key.trim();
      const rawValue = item.value ?? "";
      const hasValue = rawValue.trim().length > 0;
      if (!key) {
        if (hasValue) {
          setError("Attribute name is required when a value is provided.");
          return;
        }
        continue;
      }
      if (PRIMARY_ATTRIBUTE_KEYS.has(key)) {
        setError("Use the dedicated fields for push-endpoint and verify-ssl.");
        return;
      }
      if (seenKeys.has(key)) {
        setError(`Duplicate attribute key: ${key}.`);
        return;
      }
      const parsed = parseAttributeValue(rawValue);
      if (parsed.error) {
        setError(`${parsed.error} (${key}).`);
        return;
      }
      configuration[key] = parsed.value;
      seenKeys.add(key);
    }

    setSaving(true);
    try {
      const updated = await updateTopicConfiguration(accountId, topic.arn, configuration);
      const next = updated.configuration ?? {};
      accept(configurationDraft(next));
      onSaved(next);
      setStatus("Attributes updated.");
    } catch (error) { setError(extractApiError(error, "Unable to update topic attributes.")); }
    finally { setSaving(false); }
  };
  return <SettingsWorkflowForm title={`Topic attributes · ${topic.name}`}
    description="Configure notification delivery and provider-specific SNS attributes."
    breadcrumbs={managerPageBreadcrumbs("topics", { label: "Attributes" })} backLabel="Back to topics"
    dirty={dirty && !loading && !loadError} busy={saving} loading={loading} disabled={Boolean(loadError)}
    error={loadError || error} submitLabel="Save attributes" onSubmit={save} onClose={onClose}>
    {loading && <p role="status" className="settings-description">Loading topic attributes...</p>}
    {loadError && <div><SettingsButton variant="secondary" onClick={retry}>Retry loading</SettingsButton></div>}
    {status && <UiInlineMessage tone="success" role="status">{status}</UiInlineMessage>}
    <SettingsSection title="Notification delivery" presentation="compact">
      <div className="settings-fields">
        <UiInput
          label="Push endpoint URL"
          value={draft.pushEndpointValue}
          onChange={(event) => {
            setStatus(null);
            setError(null);
            setDraft(value => ({ ...value, pushEndpointValue: event.target.value }));
          }}
          placeholder="https://example.com/webhook"
          hint="Provide the HTTPS endpoint that should receive SNS push notifications."
          disabled={fieldsDisabled}
        />
        <div>
          <UiCheckboxField
            className="settings-choice"
            checked={draft.verifySslValue}
            aria-describedby={sslHintId}
            onChange={(event) => {
              setStatus(null);
              setError(null);
              setDraft(value => ({ ...value, verifySslValue: event.target.checked }));
            }}
            disabled={fieldsDisabled}
          >
            Verify SSL certificates
          </UiCheckboxField>
          <p id={sslHintId} className="settings-description">
            Disable verification only when testing against endpoints that use self-signed certificates.
          </p>
        </div>
      </div>
    </SettingsSection>
    <SettingsSection
      title="Additional attributes"
      description="Paste JSON for object/array values; remove a row to clear an attribute."
      presentation="compact"
    >
      <div className="settings-stack">
        <div>
          <SettingsButton variant="secondary" onClick={handleAddAttribute} disabled={fieldsDisabled}>
            Add attribute
          </SettingsButton>
        </div>
        {draft.attributeItems.length === 0 ? (
          <p className="settings-description">No additional attributes defined.</p>
        ) : (
          draft.attributeItems.map((item, index) => (
            <div key={item.uiId} className="settings-fields items-end md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <UiInput
                label="Attribute name"
                aria-label={`Attribute name ${index + 1}`}
                value={item.key}
                onChange={(event) => handleAttributeKeyChange(item.uiId, event.target.value)}
                placeholder="attribute-key"
                disabled={fieldsDisabled}
              />
              <UiInput
                label="Value"
                aria-label={`Attribute value ${index + 1}`}
                value={item.value}
                onChange={(event) => handleAttributeValueChange(item.uiId, event.target.value)}
                className="font-mono"
                placeholder='value or JSON ({"key":"value"})'
                disabled={fieldsDisabled}
              />
              <SettingsButton
                variant="secondary"
                aria-label={`Remove attribute ${index + 1}`}
                onClick={() => handleRemoveAttribute(item.uiId)}
                disabled={fieldsDisabled}
              >
                Remove
              </SettingsButton>
            </div>
          ))
        )}
      </div>
    </SettingsSection>
  </SettingsWorkflowForm>;
}
