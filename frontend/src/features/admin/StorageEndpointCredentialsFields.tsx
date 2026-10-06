/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { SettingsSection, SettingsSwitch, SettingsItem } from "../../components/settings/SettingsLayout";
import { UiButtonLink } from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiDetails from "../../components/ui/UiDetails";
import { SettingsButton, SettingsSelect } from "../../components/settings/SettingsControls";
import type { StorageEndpoint, StorageEndpointFeatureDetectionResult } from "../../api/storageEndpoints";
import {
  AdminOpsPermissionsBadges, CredentialStatusBadge, SupervisionValidationBadges,
  type CredentialCheckView,
} from "./StorageEndpointValidationStatus";
import { type FormState } from "./storageEndpointFormModel";
import type { EndpointFieldErrors } from "./storageEndpointSubmission";
import {
  ADMIN_OPS_FULL_COMMAND,
  CEPH_ADMIN_COMMAND,
  RUNTIME_READ_OPS_COMMAND,
  SUPERVISION_OPS_COMMAND,
} from "./storageEndpointCredentialHelp";

type CredentialKind = "admin" | "runtime" | "supervision" | "ceph_admin";
type Props = {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  readOnly: boolean;
  editing: boolean;
  cephAdminEnabled: boolean;
  cephAdminActive?: boolean;
  errors: EndpointFieldErrors;
  checks: Partial<Record<CredentialKind, CredentialCheckView | null>>;
  detection?: StorageEndpointFeatureDetectionResult | null;
  invalidateChecks: () => void;
  identities?: StorageEndpoint["service_identities"];
  usersWrite?: boolean;
  onReconcile?: () => void;
  reconciling?: boolean;
  configurationDirty?: boolean;
  storedAdminAccessKey?: string | null;
};

/** Each operational identity has its own credentials and validation. */
function CredentialFields({ kind, label, required = false, form, setForm, readOnly, editing, errors, invalidateChecks, storedAdminAccessKey }: Props & {
  kind: CredentialKind;
  label: string;
  required?: boolean;
}) {
  const access = `${kind}_access_key` as const;
  const secret = `${kind}_secret_key` as const;
  const stored = `has_${kind}_secret` as const;
  const storedServicePair = kind !== "admin" && editing && form[stored];
  const replacementHint = storedServicePair
    ? "Leave both fields empty to keep the current keys. Enter both values to replace them."
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

function CommandExample({ title, children }: { title: string; children: string }) {
  return <UiDetails className="settings-stack">
    <summary className="settings-label">{title}</summary>
    <pre className="whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3 settings-body">
      <code>{children}</code>
    </pre>
  </UiDetails>;
}

type ServiceKind = "runtime" | "supervision";
type ServiceIdentity = NonNullable<StorageEndpoint["service_identities"]>[number];

function savedStatusLabel(identity?: ServiceIdentity) {
  if (!identity) return "Not configured";
  const labels = {
    not_provisioned: "Not created", missing: "Not configured", provisioning: "Creating",
    ready: "Configured", error: "Needs attention", revocation_pending: "Revocation pending", disabled: "Disabled",
  };
  return labels[identity.status];
}

function ExternalCredentialFields(props: Props & { kind: "runtime" | "supervision" | "ceph_admin"; label: string; required: boolean }) {
  const { kind, label, form, errors } = props;
  const [replacing, setReplacing] = useState(false);
  const storedPair = props.editing && form[`has_${kind}_secret`];
  const fields = <CredentialFields {...props} />;
  if (props.readOnly || !storedPair) return fields;
  const showFields = replacing || Boolean(form[`${kind}_access_key`] || form[`${kind}_secret_key`]
    || errors[`${kind}_access_key`] || errors[`${kind}_secret_key`]);
  return <div className="settings-stack">
    {!showFields && <div><SettingsButton variant="secondary" onClick={() => setReplacing(true)}>Replace {label} keys</SettingsButton></div>}
    <div hidden={!showFields}>{fields}</div>
  </div>;
}

function ServiceIdentityRow(props: Props & { kind: ServiceKind; modeChanged: boolean }) {
  const { kind, form, modeChanged } = props;
  const identity = props.identities?.find(candidate => candidate.kind === kind);
  const label = kind === "runtime" ? "Runtime Read Ops" : "Supervision Ops";
  const shortLabel = kind === "runtime" ? "Runtime" : "Supervision";
  const configured = kind === "runtime" ? form.has_runtime_secret : form.has_supervision_secret;
  const draftPair = Boolean(form[`${kind}_access_key`].trim() || form[`${kind}_secret_key`].trim());
  const showCheck = form.service_identity_mode === "external" ? configured || draftPair
    : !modeChanged && identity?.mode === "managed" && configured;
  const check = showCheck ? props.checks[kind] : null;
  const checkFailed = check && ["denied", "misconfigured", "unavailable"].includes(check.status);
  const diagnostic = identity?.last_error || (checkFailed ? check.message : null);
  const blocked = identity?.status === "error" || identity?.status === "missing" || identity?.status === "revocation_pending"
    || check?.status === "denied" || check?.status === "misconfigured";
  const monitoringChecks = kind === "supervision" && check?.status === "valid" && props.detection;
  const hasDetails = blocked || diagnostic || identity?.rotation_pending || monitoringChecks || form.service_identity_mode === "external";
  return <SettingsItem compact title={label} ariaLabel={label}
    description={kind === "runtime" ? "Live reads for Manager and Portal." : "Usage and metrics collection."}
    status={<span className="settings-description">{!props.editing && form.service_identity_mode === "managed"
      ? "Creation planned" : savedStatusLabel(identity)}</span>}
    action={check ? <div className="flex flex-wrap items-center gap-2"><CredentialStatusBadge {...check} /></div> : undefined}>
    {hasDetails && <div className="settings-stack">
      {blocked && <p className="settings-description">{kind === "runtime" ? "Live enrichment is unavailable." : "Monitoring is unavailable."}</p>}
      {diagnostic && <UiDetails className="settings-stack">
        <summary className="settings-label">{shortLabel} diagnostics</summary>
        <p className="settings-description">{diagnostic}</p>
      </UiDetails>}
      {identity?.rotation_pending && <UiInlineMessage tone="warning">
        Rotation pending · {identity.rotation_phase}. <UiButtonLink to="/admin/key-rotation" variant="secondary" size="sm">Resume key rotation</UiButtonLink>
      </UiInlineMessage>}
      {monitoringChecks && props.detection && <UiDetails className="settings-stack"
        defaultOpen={!props.detection.metrics || !props.detection.usage}>
        <summary className="settings-label">Monitoring checks</summary>
        <div className="flex flex-wrap items-center gap-2"><SupervisionValidationBadges
          metrics={props.detection.metrics} usage={props.detection.usage}
          metricsError={props.detection.metrics_error} usageError={props.detection.usage_error} /></div>
        {props.detection.metrics_error && <p className="settings-description">Bucket statistics: {props.detection.metrics_error}</p>}
        {props.detection.usage_error && <p className="settings-description">Usage: {props.detection.usage_error}</p>}
      </UiDetails>}
      {form.service_identity_mode === "external" && <>
        <ExternalCredentialFields {...props} kind={kind} label={shortLabel} required />
        {!props.readOnly && <CommandExample title={`Create ${label}`}>{kind === "runtime" ? RUNTIME_READ_OPS_COMMAND : SUPERVISION_OPS_COMMAND}</CommandExample>}
      </>}
    </div>}
  </SettingsItem>;
}

export default function StorageEndpointCredentialsFields(props: Props) {
  const identityActionHelpId = useId();
  const [showCephAdminKeys, setShowCephAdminKeys] = useState(false);
  if (props.form.provider !== "ceph") return <UiInlineMessage tone="info">
    {props.form.provider === "aws"
      ? "AWS endpoints use the active execution identity and do not require dedicated management credentials here."
      : "This provider does not use dedicated operational credentials in BucketReef."}
  </UiInlineMessage>;
  const { form, identities, checks } = props;
  const savedMode = identities?.find(identity => identity.kind === "runtime")?.mode;
  const modeChanged = Boolean(props.editing && savedMode && savedMode !== form.service_identity_mode);
  const plannedManagedProvisioning = form.service_identity_mode === "managed" && (!props.editing || modeChanged);
  const initialProvisioning = form.service_identity_mode === "managed" && Boolean(identities?.some(identity =>
    (identity.kind === "runtime" || identity.kind === "supervision") && identity.mode === "managed" && identity.status === "not_provisioned"
  ));
  const needsReconciliation = ["runtime", "supervision"].some(kind => {
    const identity = identities?.find(candidate => candidate.kind === kind);
    if (identity?.mode === "managed" && identity.status === "not_provisioned") return false;
    return !identity || identity.status !== "ready" || Boolean(identity.last_error);
  });
  const showIdentityAction = Boolean(props.onReconcile && !props.configurationDirty && (initialProvisioning || needsReconciliation));
  const identityActionDisabled = Boolean(props.reconciling || (initialProvisioning && props.usersWrite !== true));
  const permissions = props.detection?.admin_ops_permissions;
  const adminCheck = checks.admin;
  const cephAdminCheck = form.ceph_admin_allowed || form.has_ceph_admin_secret || form.ceph_admin_access_key || form.ceph_admin_secret_key
    ? checks.ceph_admin : null;
  const cephAdminIdentity = identities?.find(identity => identity.kind === "ceph_admin");
  const cephAdminKeysVisible = showCephAdminKeys || Boolean(form.ceph_admin_allowed || form.ceph_admin_access_key || form.ceph_admin_secret_key
    || props.errors.ceph_admin_access_key || props.errors.ceph_admin_secret_key);
  const cephAdminFields = <div className="settings-stack">
    <ExternalCredentialFields {...props} kind="ceph_admin" label="Ceph Admin" required={form.ceph_admin_allowed} />
    {!props.readOnly && <CommandExample title="Create Ceph Admin externally">{CEPH_ADMIN_COMMAND}</CommandExample>}
    <p className="settings-description">Use an external RGW user with admin=true and system=false. Disabling access preserves its keys.</p>
  </div>;
  return <>
    <SettingsSection title="Administration (Admin Ops)" description="Bootstrap and delegated administration." presentation="compact">
      <div className="settings-stack">
        {adminCheck && <div className="flex flex-wrap items-center gap-2"><CredentialStatusBadge {...adminCheck} /></div>}
        {adminCheck?.status === "misconfigured" && adminCheck.message && <UiInlineMessage tone="error">{adminCheck.message}</UiInlineMessage>}
        <CredentialFields {...props} kind="admin" label="Admin" required={form.features.admin.enabled} />
        {adminCheck?.status === "valid" && permissions && <UiDetails className="settings-stack"
          defaultOpen={!permissions.users_read || !permissions.users_write || !permissions.accounts_read || !permissions.accounts_write}>
          <summary className="settings-label">Admin Ops permissions</summary>
          <AdminOpsPermissionsBadges permissions={permissions} />
        </UiDetails>}
        {!props.readOnly && <CommandExample title="Recommended Admin Ops">{ADMIN_OPS_FULL_COMMAND}</CommandExample>}
      </div>
    </SettingsSection>
    <SettingsSection title="Service identities" description="Dedicated live reads and monitoring." presentation="compact">
      <div className="settings-stack">
        <SettingsSelect label="Identity management" value={form.service_identity_mode} disabled={props.readOnly}
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
          <option value="managed">Managed by BucketReef</option>
          <option value="external">Provided externally</option>
        </SettingsSelect>
        {modeChanged && <UiInlineMessage tone={form.service_identity_mode === "external" ? "warning" : "info"}>
          {form.service_identity_mode === "external"
            ? "Enter both Runtime and Supervision pairs. Saving replaces and revokes the current managed identities."
            : "On save: BucketReef will create Runtime and Supervision identities. Existing external RGW users are preserved."}
          <p>Pending save · Current saved configuration: {savedMode === "managed" ? "Managed by BucketReef" : "Provided externally"}.</p>
        </UiInlineMessage>}
        <div>
          <ServiceIdentityRow {...props} kind="runtime" modeChanged={modeChanged} />
          <ServiceIdentityRow {...props} kind="supervision" modeChanged={modeChanged} />
        </div>
        {(showIdentityAction || (needsReconciliation && props.configurationDirty && !initialProvisioning)) && <div className="settings-stack">
          {showIdentityAction && <div className="flex flex-wrap items-center gap-2">
            <SettingsButton variant="secondary" disabled={identityActionDisabled} onClick={props.onReconcile}
              aria-describedby={initialProvisioning && props.usersWrite !== true ? identityActionHelpId : undefined}>
              {initialProvisioning ? "Create managed identities" : "Retry configuration"}
            </SettingsButton>
            {initialProvisioning && props.usersWrite !== true && <p id={identityActionHelpId} className="settings-description">
              {props.usersWrite === false ? "Admin Ops has no users=write permission. Restore it or supply external credentials."
                : "Validate Admin Ops with users=write before creating managed identities."}
            </p>}
          </div>}
          {needsReconciliation && props.configurationDirty && !initialProvisioning && <p className="settings-description">
            Save or discard endpoint changes before retrying the saved configuration.
          </p>}
        </div>}
        {plannedManagedProvisioning && !modeChanged && <p className="settings-description">
          {props.usersWrite === true ? "Saving creates the Runtime and Supervision identities." : "Save this endpoint, then validate Admin Ops with users=write to create the identities."}
        </p>}
        {plannedManagedProvisioning && modeChanged && props.usersWrite !== true && <p className="settings-description">
          {props.usersWrite === false ? "Admin Ops has no users=write permission. Save the mode change, then restore it to create the identities."
            : "Validate Admin Ops with users=write to create the identities after saving."}
        </p>}
        <UiDetails className="settings-stack">
          <summary className="settings-label">About service identities</summary>
          <p className="settings-description">Both identities are required for Ceph. Managed secrets stay hidden; disabling features preserves the identities. Admin Ops is never used as a fallback for live reads or monitoring.</p>
        </UiDetails>
      </div>
    </SettingsSection>
    <SettingsSection title="Ceph Admin" description="Dedicated cluster administration access." presentation="compact">
      <div className="settings-stack">
        <SettingsItem compact title="Allow Ceph Admin on this endpoint" description="Requires global enablement and validated credentials."
          action={<SettingsSwitch ariaLabel="Allow Ceph Admin on this endpoint" checked={form.ceph_admin_allowed}
            disabled={props.readOnly} onChange={value => props.setForm(previous => ({ ...previous, ceph_admin_allowed: value }))} />} />
        <p role="status" className="settings-description">Endpoint authorization: {form.ceph_admin_allowed ? "Allowed" : "Not allowed"}. Workspace access: {props.cephAdminActive ? "Active" : "Inactive"}.</p>
        {cephAdminCheck && <div className="flex flex-wrap items-center gap-2"><CredentialStatusBadge {...cephAdminCheck} /></div>}
        {cephAdminIdentity?.last_error && <UiDetails className="settings-stack">
          <summary className="settings-label">Ceph Admin diagnostics</summary>
          <p className="settings-description">{cephAdminIdentity.last_error}</p>
        </UiDetails>}
        {!props.cephAdminEnabled && <p className="settings-description">Ceph Admin is disabled in General settings. You can prepare its credentials here.</p>}
        {!cephAdminKeysVisible && <div><SettingsButton variant="secondary" onClick={() => setShowCephAdminKeys(true)}>
          {props.readOnly ? "View Ceph Admin credentials" : form.has_ceph_admin_secret ? "Manage Ceph Admin keys" : "Prepare Ceph Admin keys"}
        </SettingsButton></div>}
        <div hidden={!cephAdminKeysVisible}>{cephAdminFields}</div>
      </div>
    </SettingsSection>
  </>;
}
