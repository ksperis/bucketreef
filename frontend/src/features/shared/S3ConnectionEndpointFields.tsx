/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import type { StorageEndpoint } from "../../api/storageEndpoints";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiCheckboxClass } from "../../components/ui/styles";
import type { S3ConnectionEndpointMode } from "./s3ConnectionFormModel";

const S3_CONNECTION_PROVIDER_HINT_OPTIONS = [
  { value: "", label: "(auto)" },
  { value: "aws", label: "AWS" },
  { value: "ceph", label: "Ceph RGW" },
  { value: "scality", label: "Scality" },
  { value: "minio", label: "MinIO" },
  { value: "other", label: "Other" },
];

type S3ConnectionEndpointDraft = {
  provider_hint: string;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  verify_tls: boolean;
};

type S3ConnectionEndpointFieldsProps = {
  mode: S3ConnectionEndpointMode;
  onModeChange: (mode: S3ConnectionEndpointMode) => void;
  modeInputName: string;
  endpointId: string;
  onEndpointIdChange: (endpointId: string) => void;
  endpoints: Array<Pick<StorageEndpoint, "id" | "name" | "endpoint_url" | "is_default">>;
  loadingEndpoints: boolean;
  form: S3ConnectionEndpointDraft;
  onFormChange: <K extends keyof S3ConnectionEndpointDraft>(field: K, value: S3ConnectionEndpointDraft[K]) => void;
  errorMessage?: string | null;
  endpointIdError?: string;
  endpointUrlError?: string;
};

export default function S3ConnectionEndpointFields({
  mode,
  onModeChange,
  modeInputName,
  endpointId,
  onEndpointIdChange,
  endpoints,
  loadingEndpoints,
  form,
  onFormChange,
  errorMessage,
  endpointIdError,
  endpointUrlError,
}: S3ConnectionEndpointFieldsProps) {
  const hasConfiguredEndpoints = endpoints.length > 0;

  return (
    <SettingsSection title="Endpoint" presentation="compact"
      description="Choose a configured endpoint or enter an operator-approved public HTTPS custom endpoint.">
      <div className="settings-fields">
        <fieldset className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
          <legend className="sr-only">Endpoint source</legend>
          <label className="settings-choice">
            <input
              type="radio"
              name={modeInputName}
              value="preset"
              checked={mode === "preset"}
              onChange={() => onModeChange("preset")}
              disabled={!hasConfiguredEndpoints}
              className={cx(uiCheckboxClass, "rounded-full disabled:opacity-60")}
            />
            Configured endpoint
          </label>
          <label className="settings-choice">
            <input
              type="radio"
              name={modeInputName}
              value="custom"
              checked={mode === "custom"}
              onChange={() => onModeChange("custom")}
              className={cx(uiCheckboxClass, "rounded-full")}
            />
            Custom endpoint
          </label>
        </fieldset>
        {mode === "preset" ? (
          <UiSelect
            label="Configured endpoint"
            value={endpointId}
            onChange={(event) => onEndpointIdChange(event.target.value)}
            disabled={loadingEndpoints}
            error={endpointIdError}
          >
            <option value="">
              {loadingEndpoints
                ? "Loading endpoints..."
                : hasConfiguredEndpoints
                  ? "Select endpoint"
                  : "No configured endpoint"}
            </option>
            {endpointId && !endpoints.some((endpoint) => String(endpoint.id) === endpointId) && (
              <option value={endpointId} disabled>{loadingEndpoints ? "Loading endpoint..." : `Unavailable endpoint (#${endpointId})`}</option>
            )}
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name} ({endpoint.endpoint_url})
              </option>
            ))}
          </UiSelect>
        ) : (
          <div className="settings-fields sm:grid-cols-2">
            <UiSelect
              label="Provider"
              value={form.provider_hint}
              onChange={(event) => onFormChange("provider_hint", event.target.value)}
            >
              {S3_CONNECTION_PROVIDER_HINT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UiSelect>
            <UiInput
              type="text"
              label="Region"
              value={form.region}
              onChange={(event) => onFormChange("region", event.target.value)}
              placeholder="us-east-1"
            />
            <UiInput
              type="url"
              label="Endpoint URL"
              error={endpointUrlError}
              fieldClassName="sm:col-span-2"
              value={form.endpoint_url}
              onChange={(event) => onFormChange("endpoint_url", event.target.value)}
              placeholder="https://s3.example.com"
            />
            <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
              <UiCheckboxField
                checked={form.force_path_style}
                onChange={(event) => onFormChange("force_path_style", event.target.checked)}
                className="settings-choice"
              >
                Force path style
              </UiCheckboxField>
              <UiCheckboxField
                checked={form.verify_tls}
                onChange={(event) => onFormChange("verify_tls", event.target.checked)}
                className="settings-choice"
              >
                Verify TLS
              </UiCheckboxField>
            </div>
          </div>
        )}
        {errorMessage && <UiInlineMessage tone="warning">{errorMessage}</UiInlineMessage>}
      </div>
    </SettingsSection>
  );
}
