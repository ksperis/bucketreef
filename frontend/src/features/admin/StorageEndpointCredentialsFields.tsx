/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useId, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { UiButtonLink } from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiDetails from "../../components/ui/UiDetails";
import { SettingsButton, SettingsSelect } from "../../components/settings/SettingsControls";
import type { StorageEndpoint } from "../../api/storageEndpoints";
import { type FormState } from "./storageEndpointFormModel";
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
  configurationDirty?: boolean;
  storedAdminAccessKey?: string | null;
};

/** Each operational identity has its own credentials and validation. */
function CredentialFields({ kind, label, required = false, form, setForm, readOnly, editing, errors, statuses, invalidateChecks, storedAdminAccessKey }: Props & {
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
  const replacementHintId = useId();
  const canReuseAdminSecret = kind === "admin" && editing && form[stored]
    && form[access].trim() === storedAdminAccessKey?.trim();
  const secretHint = replacementHint ? undefined : canReuseAdminSecret
    ? "Leave the secret key empty to keep the current one."
    : required ? "Enter the secret key for this identity." : undefined;
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
        aria-describedby={replacementHint ? replacementHintId : undefined}
        error={errors[access]} onChange={event => change(access, event.target.value)} />
      {readOnly ? <div className="settings-stack">
        <p className="settings-label">{label} secret key</p>
        <div className="settings-readonly">{form[stored] ? "Stored — value hidden" : "Not configured"}</div>
      </div> : <UiInput label={`${label} secret key`} type="password" autoComplete="new-password"
        value={form[secret]} required={required && !storedServicePair && !canReuseAdminSecret} error={errors[secret]}
        aria-describedby={replacementHint ? replacementHintId : undefined}
        hint={secretHint}
        onChange={event => change(secret, event.target.value)} />}
    </div>}
    {replacementHint && !readOnly && <p id={replacementHintId} className="settings-description">{replacementHint}</p>}
  </div>;
}

function CommandExample({ title, children, defaultOpen = false }: { title: string; children: string; defaultOpen?: boolean }) {
  return <UiDetails className="settings-stack" defaultOpen={defaultOpen}>
    <summary className="settings-label">{title}</summary>
    <pre className="whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3 settings-body">
      <code>{children}</code>
    </pre>
  </UiDetails>;
}

export default function StorageEndpointCredentialsFields(props: Props) {
  if (props.form.provider !== "ceph") return <UiInlineMessage tone="info">
    {props.form.provider === "aws"
      ? "AWS endpoints use the active execution identity and do not require dedicated management credentials here."
      : "This provider does not use dedicated operational credentials in BucketReef."}
  </UiInlineMessage>;
  const savedMode = props.identities?.find(identity => identity.kind === "runtime")?.mode;
  const modeChanged = props.editing && savedMode && savedMode !== props.form.service_identity_mode;
  const needsReconciliation = ["runtime", "supervision", ...(props.cephAdminEnabled && props.form.ceph_admin_allowed ? ["ceph_admin"] : [])]
    .some(kind => {
      const identity = props.identities?.find(candidate => candidate.kind === kind);
      return !identity || identity.status !== "ready" || Boolean(identity.last_error);
    });
  return <>
    <SettingsSection title="Administration (Admin Ops)" description="Bootstrap and delegated administration." presentation="compact">
      <CredentialFields {...props} kind="admin" label="Admin" required={props.form.features.admin.enabled} />
      {!props.readOnly && <CommandExample title="Recommended Admin Ops" defaultOpen={!props.form.has_admin_secret}>{ADMIN_OPS_FULL_COMMAND}</CommandExample>}
    </SettingsSection>
    <SettingsSection title="Service identities" description="Runtime handles live reads; Supervision handles usage and metrics. Both are required for Ceph." presentation="compact">
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
      {props.form.service_identity_mode === "managed" && <p className="settings-description">BucketReef manages these identities and keeps their secrets hidden. Disabling features preserves them.</p>}
      {modeChanged && <UiInlineMessage tone="warning">{props.form.service_identity_mode === "external"
        ? "Enter both Runtime and Supervision pairs. Saving replaces and revokes the current managed identities."
        : "Saving creates managed Runtime and Supervision identities. Existing external RGW users are left unchanged."}</UiInlineMessage>}
      {Boolean(props.identities?.length) && <p className="settings-label">Saved configuration</p>}
      {props.identities?.map(identity => <div key={identity.kind} role="status" className="settings-stack">
        <p>{identity.kind === "runtime" ? "Runtime Read Ops" : identity.kind === "supervision" ? "Supervision Ops" : "Ceph Admin"} · {identity.mode === "managed" ? "Managed" : "External"} · {identity.status === "ready" ? "Ready" : identity.status.replaceAll("_", " ")}</p>
        {identity.rotation_pending && <UiInlineMessage tone="warning">Rotation pending · {identity.rotation_phase}. Retry this category from S3 key rotation.</UiInlineMessage>}
        {identity.last_error && <UiInlineMessage tone="error">{identity.last_error}</UiInlineMessage>}
      </div>)}
      {props.editing && !props.identities?.some(identity => identity.kind === "runtime" && identity.status === "ready") && <UiInlineMessage tone="warning">Configure Runtime Read Ops to restore live enrichment. Admin Ops is never used as a fallback.</UiInlineMessage>}
      {props.identities?.some(identity => identity.rotation_pending) && <UiButtonLink to="/admin/key-rotation" variant="secondary" size="sm">Resume key rotation</UiButtonLink>}
      {props.onReconcile && needsReconciliation && <>
        <SettingsButton variant="secondary" disabled={props.reconciling || props.configurationDirty} onClick={props.onReconcile}>Retry service identity configuration</SettingsButton>
        {props.configurationDirty && <p className="settings-description">Save or discard endpoint changes before retrying the saved configuration.</p>}
      </>}
    </SettingsSection>
    {props.form.service_identity_mode === "external" && <SettingsSection title="Live reads (Runtime Read Ops)" description="Read-only accounts, users without keys, and bucket statistics for Manager and Portal." presentation="compact">
      <CredentialFields {...props} kind="runtime" label="Runtime" required />
      {!props.readOnly && <CommandExample title="Create Runtime Read Ops" defaultOpen={!props.form.has_runtime_secret}>{RUNTIME_READ_OPS_COMMAND}</CommandExample>}
    </SettingsSection>}
    {props.form.service_identity_mode === "external" && <SettingsSection title="Monitoring (Supervision Ops)" description="Read-only usage and metrics collection." presentation="compact">
      <CredentialFields {...props} kind="supervision" label="Supervision" required />
      {!props.readOnly && <CommandExample title="Create Supervision Ops" defaultOpen={!props.form.has_supervision_secret}>{SUPERVISION_OPS_COMMAND}</CommandExample>}
    </SettingsSection>}
    {props.cephAdminEnabled && <SettingsSection title="Ceph Admin" description="Select authorized endpoints in General settings. BucketReef creates a dedicated managed identity before granting access." presentation="compact">
      <p className="settings-description">Endpoint authorization: {props.form.ceph_admin_allowed ? "Allowed" : "Not allowed"}. Disabling access revokes the managed identity without purging data.</p>
    </SettingsSection>}
  </>;
}
