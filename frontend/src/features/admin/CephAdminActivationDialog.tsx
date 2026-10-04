/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState } from "react";
import { configureCephAdmin, listStorageEndpoints, type CephAdminActivationResult, type StorageEndpoint } from "../../api/storageEndpoints";
import { isRecentWebAuthnVerificationCancelled, useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import { SettingsChoiceRow } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";

export default function CephAdminActivationDialog({ enabled, onApplied, onClose }: {
  enabled: boolean; onApplied: () => Promise<void>; onClose: () => void;
}) {
  const [endpoints, setEndpoints] = useState<StorageEndpoint[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [grant, setGrant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CephAdminActivationResult | null>(null);
  const pending = useRef(false);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  useEffect(() => {
    let active = true;
    listStorageEndpoints({ include_admin_ops_permissions: true }).then(rows => {
      if (!active) return;
      const ceph = rows.filter(row => row.provider === "ceph");
      setEndpoints(ceph);
      setSelected(ceph.filter(row => row.ceph_admin_allowed && row.admin_ops_permissions?.users_write).map(row => row.id));
    }).catch(cause => { if (active) setError(extractApiError(cause, "Unable to load Ceph endpoints.")); });
    return () => { active = false; };
  }, []);
  const completed = Boolean(result && result.endpoints.every(row => enabled
    ? selected.includes(row.endpoint_id) ? row.active : row.status !== "revocation_pending" && !row.error
    : row.status !== "revocation_pending" && !row.error));
  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null);
    try {
      const saved = await runWithStepUp(() => configureCephAdmin({ enabled, endpoint_ids: selected, grant_current_user: grant }));
      setResult(saved);
      await onApplied();
    } catch (cause) {
      if (!isRecentWebAuthnVerificationCancelled(cause)) setError(extractApiError(cause, "Unable to configure Ceph Admin."));
    } finally { pending.current = false; setBusy(false); }
  };
  return <>
    <SettingsFormDialog title={enabled ? "Authorize Ceph Admin endpoints" : "Disable Ceph Admin"}
      draftKey={JSON.stringify([selected, grant])} busy={busy} error={error} completed={completed}
      submitLabel={result ? "Retry pending operations" : enabled ? "Activate Ceph Admin" : "Disable and revoke identities"}
      submitDisabled={!endpoints || (enabled && selected.length === 0)} onSubmit={submit} onClose={onClose}>
      <p className="settings-description">{enabled
        ? "Select the Ceph endpoints accessible from this workspace. BucketReef creates and validates a dedicated managed identity on each selected endpoint."
        : "Workspace access stops immediately. Managed Ceph Admin identities are removed without purging data. Endpoint authorizations are preserved for the next activation."}</p>
      {!endpoints && <p role="status">Loading endpoints…</p>}
      {enabled && endpoints?.map(endpoint => <SettingsChoiceRow key={endpoint.id} title={endpoint.name} ariaLabel={endpoint.name}
        checked={selected.includes(endpoint.id)} disabled={busy || !endpoint.admin_ops_permissions?.users_write}
        onChange={checked => setSelected(current => checked ? [...current, endpoint.id] : current.filter(id => id !== endpoint.id))}
        description={!endpoint.admin_ops_permissions?.users_write ? "Admin Ops users=write required." : undefined}>
        {endpoint.service_identities?.some(row => row.kind === "ceph_admin" && row.mode === "external") && <span className="block settings-description">Selecting this endpoint replaces the external credentials with a managed identity. Its existing RGW user is preserved.</span>}
      </SettingsChoiceRow>)}
      {enabled && <SettingsChoiceRow title="Grant me access to the Ceph Admin workspace" ariaLabel="Grant me access to the Ceph Admin workspace" checked={grant} disabled={busy} onChange={setGrant} />}
      {result?.endpoints.map(row => <div key={row.endpoint_id} role="status">
        <p>{endpoints?.find(endpoint => endpoint.id === row.endpoint_id)?.name ?? row.endpoint_id} · {row.active ? "Active" : row.status}</p>
        {row.error && <UiInlineMessage tone="error">{row.error}</UiInlineMessage>}
      </div>)}
    </SettingsFormDialog>
    {verificationDialog}
  </>;
}
