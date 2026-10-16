/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { StorageEndpoint } from "../../api/storageEndpoints";
import UiSelect from "../../components/ui/UiSelect";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useAdminI18n } from "./adminI18n";

export default function AdminRgwEndpointField({
  label, value, onChange, endpoints, loading, operation, permissionLoading, permissionError, canWrite, error,
}: {
  label: string; value: string; onChange: (value: string) => void;
  endpoints: StorageEndpoint[]; loading: boolean; operation: "accounts" | "users";
  permissionLoading: boolean; permissionError: string | null; canWrite: boolean; error?: string;
}) {
  const { text: adminText } = useAdminI18n();
  return <div className="settings-fields">
    <UiSelect label={label} name="storage_endpoint_id" value={value} required error={error}
      onChange={event => onChange(event.target.value)} disabled={loading || endpoints.length === 0}>
      <option value="" disabled>{loading ? "Loading..." : endpoints.length ? "Select" : operation === "accounts" ? "No Ceph endpoint with account API enabled" : "No Ceph endpoint with admin enabled"}</option>
      {endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}{endpoint.is_default ? " (default)" : ""}</option>)}
    </UiSelect>
    {value && (permissionLoading ? <UiInlineMessage tone="info" role="status">{adminText("Checking endpoint permissions...")}</UiInlineMessage>
      : permissionError ? <UiInlineMessage tone="warning">{permissionError}{adminText(". Validation is disabled until permissions can be verified.")}</UiInlineMessage>
      : !canWrite ? <UiInlineMessage tone="warning">{adminText("Selected endpoint does not allow this operation: missing")}<code>{operation}{adminText("=write")}</code>.</UiInlineMessage> : null)}
  </div>;
}
