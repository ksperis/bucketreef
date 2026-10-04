/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { UiButtonLink } from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { SettingsButton, SettingsSelect } from "../../components/settings/SettingsControls";
import type { StorageEndpoint } from "../../api/storageEndpoints";
import { supervisionRequired, type FormState } from "./storageEndpointFormModel";
import type { EndpointFieldErrors } from "./storageEndpointSubmission";
import {
  ADMIN_OPS_FULL_COMMAND,
  RUNTIME_READ_OPS_COMMAND,
  SUPERVISION_OPS_COMMAND,
} from "./storageEndpointCredentialHelp";

type CredentialKind = "admin" | "runtime" | "supervision";
type Props = {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  readOnly: boolean;
  editing: boolean;
  cephAdminEnabled: boolean;
  errors: EndpointFieldErrors;
  statuses: Partial<Record<CredentialKind, ReactNode>>;
  invalidateChecks: () => void;
  identities?: StorageEndpoint["service_identities"];
  usersWrite?: boolean;
  onReconcile?: () => void;
  reconciling?: boolean;
};

/** Each operational identity has its own credentials and validation. */
function CredentialFields({ kind, label, required = false, form, setForm, readOnly, editing, errors, statuses, invalidateChecks }: Props & {
  kind: CredentialKind;
  label: string;
  required?: boolean;
}) {
  const access = `${kind}_access_key` as const;
  const secret = `${kind}_secret_key` as const;
  const stored = `has_${kind}_secret` as const;
  const storedServicePair = kind !== "admin" && editing && form[stored];
  const replacementHint = storedServicePair
    ? "Stored credentials are configured. Leave both fields empty to keep them, or enter both values to replace the pair."
    : undefined;
  const change = (field: typeof access | typeof secret, value: string) => {
    invalidateChecks();
    setForm(previous => ({ ...previous, [field]: value }));
  };
  return <div className="settings-fields">
    {statuses[kind] && <div>{statuses[kind]}</div>}
    {readOnly && kind !== "admin" ? <div className="settings-stack">
      <p className="settings-label">{label} credentials</p>
      <div className="settings-readonly">{form[stored] ? "Configured — values hidden" : "Not configured"}</div>
    </div> :
    <div className="settings-fields sm:grid-cols-2">
      <UiInput label={`${label} access key`} value={form[access]} readOnly={readOnly} required={required && !storedServicePair}
        hint={replacementHint}
        error={errors[access]} onChange={event => change(access, event.target.value)} />
      {readOnly ? <div className="settings-stack">
        <p className="settings-label">{label} secret key</p>
        <div className="settings-readonly">{form[stored] ? "Stored — value hidden" : "Not configured"}</div>
      </div> : <UiInput label={`${label} secret key`} type="password" autoComplete="new-password"
        value={form[secret]} required={!editing && required} error={errors[secret]}
        hint={replacementHint ?? (editing ? "Leave the secret key empty to keep the current one." : required ? "Required for the enabled service." : undefined)}
        onChange={event => change(secret, event.target.value)} />}
    </div>}
  </div>;
}

function CommandExample({ title, children }: { title: string; children: string }) {
  return <div className="settings-stack">
    <h3 className="settings-label">{title}</h3>
    <pre className="whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3 settings-body">
      <code>{children}</code>
    </pre>
  </div>;
}

export default function StorageEndpointCredentialsFields(props: Props) {
  if (props.form.provider !== "ceph") return <UiInlineMessage tone="info">
    {props.form.provider === "aws"
      ? "AWS endpoints use the active execution identity and do not require dedicated management credentials here."
      : "This provider does not use dedicated operational credentials in BucketReef."}
  </UiInlineMessage>;
  return <>
    <SettingsSection title="Administration (Admin Ops)" description="Bootstrap and delegated administration." presentation="compact">
      <CredentialFields {...props} kind="admin" label="Admin" required={props.form.features.admin.enabled} />
      <CommandExample title="Full Admin Ops example">{ADMIN_OPS_FULL_COMMAND}</CommandExample>
      <p className="settings-description">This command enables all Admin Ops capabilities used by current BucketReef features. See the Ceph RGW backend documentation for a least-privilege setup.</p>
    </SettingsSection>
    <SettingsSection title="Service identities" description="Managed identities are created when you save. External identities are provisioned by your operator." presentation="compact">
      <SettingsSelect label="Identity management" value={props.form.service_identity_mode} disabled={props.readOnly}
        onChange={event => {
          const mode = event.target.value as FormState["service_identity_mode"];
          props.invalidateChecks();
          props.setForm(previous => ({ ...previous, service_identity_mode: mode,
            ...(mode === "external" && previous.service_identity_mode === "managed" ? {
              runtime_access_key: "", runtime_secret_key: "", has_runtime_secret: false,
              supervision_access_key: "", supervision_secret_key: "", has_supervision_secret: false,
            } : {}),
          }));
        }}>
        <option value="managed" disabled={props.usersWrite === false && !props.identities?.some(identity => identity.mode === "managed" && identity.status === "ready")}>Managed by BucketReef</option>
        <option value="external">Provided externally</option>
      </SettingsSelect>
      {props.usersWrite === false && <UiInlineMessage tone="info">Admin Ops has no users=write permission. Ready managed identities remain usable. Creating, converting or rotating identities requires this permission; otherwise supply external credentials.</UiInlineMessage>}
      {props.form.service_identity_mode === "managed" && <UiInlineMessage tone="info">Saving creates Runtime Read Ops and, if Metrics, Usage or a signed S3 healthcheck is enabled, Supervision Ops. Generated secrets stay encrypted and are never displayed. Converting external identities leaves their RGW users unchanged.</UiInlineMessage>}
      {props.identities?.map(identity => <div key={identity.kind} role="status" className="settings-stack">
        <p>{identity.kind === "runtime" ? "Runtime Read Ops" : identity.kind === "supervision" ? "Supervision Ops" : "Ceph Admin"} · {identity.mode} · {identity.status}</p>
        {identity.rotation_pending && <UiInlineMessage tone="warning">Rotation pending · {identity.rotation_phase}. Retry this category from S3 key rotation.</UiInlineMessage>}
        {identity.last_error && <UiInlineMessage tone="error">{identity.last_error}</UiInlineMessage>}
      </div>)}
      {props.editing && !props.identities?.some(identity => identity.kind === "runtime" && identity.status === "ready") && <UiInlineMessage tone="warning">Configure Runtime Read Ops to restore live enrichment. Admin Ops is never used as a fallback.</UiInlineMessage>}
      {props.identities?.some(identity => identity.rotation_pending) && <UiButtonLink to="/admin/key-rotation" variant="secondary" size="sm">Resume key rotation</UiButtonLink>}
      {props.onReconcile && <SettingsButton variant="secondary" disabled={props.reconciling} onClick={props.onReconcile}>Retry service identity configuration</SettingsButton>}
    </SettingsSection>
    {props.form.service_identity_mode === "external" && <SettingsSection title="Live reads (Runtime Read Ops)" description="Read-only accounts, users without keys, and bucket statistics for Manager and Portal." presentation="compact">
      <CredentialFields {...props} kind="runtime" label="Runtime" required />
      <CommandExample title="Runtime Read Ops">{RUNTIME_READ_OPS_COMMAND}</CommandExample>
    </SettingsSection>}
    {props.form.service_identity_mode === "external" && <SettingsSection title="Monitoring (Supervision Ops)" description="Read-only usage and metrics collection." presentation="compact">
      <CredentialFields {...props} kind="supervision" label="Supervision" required={supervisionRequired(props.form.features)} />
      <CommandExample title="Supervision Ops">{SUPERVISION_OPS_COMMAND}</CommandExample>
    </SettingsSection>}
    {props.cephAdminEnabled && <SettingsSection title="Ceph Admin" description="Select authorized endpoints in General settings. BucketReef creates a dedicated managed identity before granting access." presentation="compact">
      <p className="settings-description">Endpoint authorization: {props.form.ceph_admin_allowed ? "Allowed" : "Not allowed"}. Disabling access revokes the managed identity without purging data.</p>
    </SettingsSection>}
  </>;
}
