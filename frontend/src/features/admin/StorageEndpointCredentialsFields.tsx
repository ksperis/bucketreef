/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import type { FormState } from "./storageEndpointFormModel";
import type { EndpointFieldErrors } from "./storageEndpointSubmission";

const ADMIN_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-admin" \\',
  '  --display-name="BucketReef Admin Ops" \\',
  '  --caps="users=read,write;accounts=read,write;buckets=write"',
].join("\n");
const SUPERVISION_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-supervision" \\',
  '  --display-name="BucketReef Supervision Ops" \\',
  '  --caps="usage=read;buckets=read"',
].join("\n");
const CEPH_ADMIN_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-ceph-admin" \\',
  '  --display-name="BucketReef Ceph Admin" \\',
  '  --admin',
].join("\n");

type CredentialKind = "admin" | "supervision" | "ceph_admin";
type Props = {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  readOnly: boolean;
  editing: boolean;
  cephAdminEnabled: boolean;
  errors: EndpointFieldErrors;
  statuses: Record<CredentialKind, ReactNode>;
  invalidateChecks: () => void;
};

/** The three purposes share fields and stored-secret presentation, never credentials. */
function CredentialFields({ kind, label, required = false, form, setForm, readOnly, editing, errors, statuses, invalidateChecks }: Props & {
  kind: CredentialKind;
  label: string;
  required?: boolean;
}) {
  const access = `${kind}_access_key` as const;
  const secret = `${kind}_secret_key` as const;
  const stored = `has_${kind}_secret` as const;
  const change = (field: typeof access | typeof secret, value: string) => {
    invalidateChecks();
    setForm(previous => ({ ...previous, [field]: value }));
  };
  return <div className="settings-fields">
    {statuses[kind] && <div>{statuses[kind]}</div>}
    <div className="settings-fields sm:grid-cols-2">
      <UiInput label={`${label} access key`} value={form[access]} readOnly={readOnly} required={required}
        error={errors[access]} onChange={event => change(access, event.target.value)} />
      {readOnly ? <div className="settings-stack">
        <p className="settings-label">{label} secret key</p>
        <div className="settings-readonly">{form[stored] ? "Stored — value hidden" : "Not configured"}</div>
      </div> : <UiInput label={`${label} secret key`} type="password" autoComplete="new-password"
        value={form[secret]} required={!editing && required} error={errors[secret]}
        hint={editing ? "Leave the secret key empty to keep the current one." : required ? "Required for the enabled service." : undefined}
        onChange={event => change(secret, event.target.value)} />}
    </div>
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
    <SettingsSection title="Administration (Admin Ops)" description="Credentials for platform provisioning and explicitly delegated bucket quotas." presentation="compact">
      <CredentialFields {...props} kind="admin" label="Admin" required={props.form.features.admin.enabled} />
    </SettingsSection>
    <SettingsSection title="Monitoring (Supervision Ops)" description="Use these keys for read-only monitoring actions." presentation="compact">
      <CredentialFields {...props} kind="supervision" label="Supervision" required={props.form.features.usage.enabled || props.form.features.metrics.enabled} />
    </SettingsSection>
    <SettingsSection title="What are Admin Ops and Supervision Ops?" description="Ceph (radosgw-admin) examples" presentation="compact">
      <div className="settings-stack">
        <p className="settings-description">
          Admin Ops keys let BucketReef create RGW accounts and S3 users, and apply explicitly delegated Manager bucket quota changes.
          Individual bucket quota changes require the <code>buckets=write</code> capability included in the example below.
          If you do not provide Admin Ops keys, you must create accounts/users outside of BucketReef and import them manually (or via the API).
        </p>
        <p className="settings-description">Supervision Ops keys are read-only credentials used for usage logs and metrics collection.</p>
        <CommandExample title="Admin Ops">{ADMIN_OPS_COMMAND}</CommandExample>
        <CommandExample title="Supervision Ops">{SUPERVISION_OPS_COMMAND}</CommandExample>
      </div>
    </SettingsSection>
    {props.cephAdminEnabled && <SettingsSection title="Ceph Admin dedicated credentials"
      description="A separate identity for advanced cluster-wide operations." presentation="compact">
      <div className="settings-stack">
        <UiInlineMessage tone="warning">
          These credentials are used only by the Ceph Admin workspace, independently of Admin Ops and its enabled feature flag.
          Keep this account dedicated to Ceph Admin.
        </UiInlineMessage>
        <CredentialFields {...props} kind="ceph_admin" label="Ceph Admin" />
        <CommandExample title="Ceph (radosgw-admin) example">{CEPH_ADMIN_COMMAND}</CommandExample>
      </div>
    </SettingsSection>}
  </>;
}
