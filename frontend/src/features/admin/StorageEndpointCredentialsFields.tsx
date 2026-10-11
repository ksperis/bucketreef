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
import { serviceIdentityRequirements, type FormState } from "./storageEndpointFormModel";
import type { EndpointFieldErrors } from "./storageEndpointSubmission";
import {
  ADMIN_OPS_FULL_COMMAND,
  CEPH_ADMIN_COMMAND,
  RUNTIME_READ_OPS_COMMAND,
  SUPERVISION_OPS_COMMAND,
} from "./storageEndpointCredentialHelp";
import { useStorageEndpointI18n, type StorageEndpointText } from "./storageEndpointMessages";

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
  const { text } = useStorageEndpointI18n();
  const access = `${kind}_access_key` as const;
  const secret = `${kind}_secret_key` as const;
  const stored = `has_${kind}_secret` as const;
  const storedServicePair = kind !== "admin" && editing && form[stored];
  const replacementHint = storedServicePair
    ? text("leaveKeysEmpty")
    : undefined;
  const replacementHintId = useId();
  const canReuseAdminSecret = kind === "admin" && editing && form[stored]
    && form[access].trim() === storedAdminAccessKey?.trim();
  const secretHint = replacementHint ? undefined : canReuseAdminSecret
    ? text("leaveSecretEmpty")
    : required ? text("enterSecretForIdentity") : undefined;
  const change = (field: typeof access | typeof secret, value: string) => {
    invalidateChecks();
    setForm(previous => ({ ...previous, [field]: value }));
  };
  return <div className="settings-fields">
    {readOnly && kind !== "admin" ? <div className="settings-stack">
      <p className="settings-label">{text("credentialsFor", { label })}</p>
      <div className="settings-readonly">{form[stored] ? text("configuredValuesHidden") : text("notConfigured")}</div>
    </div> :
    <div className="settings-fields sm:grid-cols-2">
      <UiInput label={text("accessKey", { label })} value={form[access]} readOnly={readOnly} required={required && !storedServicePair}
        aria-describedby={replacementHint ? replacementHintId : undefined}
        error={errors[access]} onChange={event => change(access, event.target.value)} />
      {readOnly ? <div className="settings-stack">
        <p className="settings-label">{text("secretKey", { label })}</p>
        <div className="settings-readonly">{form[stored] ? text("storedValueHidden") : text("notConfigured")}</div>
      </div> : <UiInput label={text("secretKey", { label })} type="password" autoComplete="new-password"
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

function savedStatusLabel(identity: ServiceIdentity | undefined, text: StorageEndpointText) {
  if (!identity) return text("notConfigured");
  const labels = {
    not_provisioned: text("notCreated"), missing: text("notConfigured"), provisioning: text("creating"),
    ready: text("configured"), error: text("needsAttention"), revocation_pending: text("revocationPending"), disabled: text("disabled"),
  };
  return labels[identity.status];
}

function ExternalCredentialFields(props: Props & { kind: "runtime" | "supervision" | "ceph_admin"; label: string; required: boolean }) {
  const { text } = useStorageEndpointI18n();
  const { kind, label, form, errors } = props;
  const [replacing, setReplacing] = useState(false);
  const storedPair = props.editing && form[`has_${kind}_secret`];
  const fields = <CredentialFields {...props} />;
  if (props.readOnly || !storedPair) return fields;
  const showFields = replacing || Boolean(form[`${kind}_access_key`] || form[`${kind}_secret_key`]
    || errors[`${kind}_access_key`] || errors[`${kind}_secret_key`]);
  return <div className="settings-stack">
    {!showFields && <div><SettingsButton variant="secondary" onClick={() => setReplacing(true)}>{text("replaceKeys", { label })}</SettingsButton></div>}
    <div hidden={!showFields}>{fields}</div>
  </div>;
}

function ServiceIdentityRow(props: Props & { kind: ServiceKind; modeChanged: boolean }) {
  const { text } = useStorageEndpointI18n();
  const { kind, form, modeChanged } = props;
  const identity = props.identities?.find(candidate => candidate.kind === kind);
  const label = kind === "runtime" ? text("runtimeReadOps") : text("supervisionOps");
  const shortLabel = kind === "runtime" ? text("runtimeShort") : text("supervisionShort");
  const configured = kind === "runtime" ? form.has_runtime_secret : form.has_supervision_secret;
  const required = serviceIdentityRequirements(form.features)[kind] || Boolean(modeChanged && identity?.mode === "managed"
    && (identity.credentials_configured || identity.rgw_uid || identity.status === "provisioning" || identity.status === "revocation_pending"));
  const draftPair = Boolean(form[`${kind}_access_key`].trim() || form[`${kind}_secret_key`].trim());
  const showCheck = form.service_identity_mode === "external" ? configured || draftPair
    : !modeChanged && identity?.mode === "managed" && configured;
  const check = showCheck ? props.checks[kind] : null;
  const checkFailed = check && ["denied", "misconfigured", "unavailable"].includes(check.status);
  const diagnostic = identity?.last_error || (checkFailed ? check.message : null);
  const blocked = identity?.status === "error" || (required && identity?.status === "missing") || identity?.status === "revocation_pending"
    || check?.status === "denied" || check?.status === "misconfigured";
  const monitoringChecks = kind === "supervision" && check?.status === "valid" && props.detection;
  const hasDetails = blocked || diagnostic || identity?.rotation_pending || monitoringChecks || form.service_identity_mode === "external";
  return <SettingsItem compact title={label} ariaLabel={label}
    description={kind === "runtime" ? text("liveReadsManagerPortal") : text("usageMetricsCollection")}
    status={<span className="settings-description">{!props.editing && form.service_identity_mode === "managed"
      ? required ? text("creationPlanned") : text("notNeededFeatures") : savedStatusLabel(identity, text)}</span>}
    action={check ? <div className="flex flex-wrap items-center gap-2"><CredentialStatusBadge {...check} /></div> : undefined}>
    {hasDetails && <div className="settings-stack">
      {blocked && <p className="settings-description">{kind === "runtime" ? text("liveEnrichmentUnavailable") : text("monitoringUnavailable")}</p>}
      {diagnostic && <UiDetails className="settings-stack">
        <summary className="settings-label">{text("diagnostics", { label: shortLabel })}</summary>
        <p className="settings-description">{diagnostic}</p>
      </UiDetails>}
      {identity?.rotation_pending && <UiInlineMessage tone="warning">
        {text("rotationPending", { phase: identity.rotation_phase ?? "" })} <UiButtonLink to="/admin/key-rotation" variant="secondary" size="sm">{text("resumeKeyRotation")}</UiButtonLink>
      </UiInlineMessage>}
      {monitoringChecks && props.detection && <UiDetails className="settings-stack"
        defaultOpen={!props.detection.metrics || !props.detection.usage}>
        <summary className="settings-label">{text("monitoringChecks")}</summary>
        <div className="flex flex-wrap items-center gap-2"><SupervisionValidationBadges
          metrics={props.detection.metrics} usage={props.detection.usage}
          metricsError={props.detection.metrics_error} usageError={props.detection.usage_error} /></div>
        {props.detection.metrics_error && <p className="settings-description">{text("bucketStatistics", { error: props.detection.metrics_error })}</p>}
        {props.detection.usage_error && <p className="settings-description">{text("usage", { error: props.detection.usage_error })}</p>}
      </UiDetails>}
      {form.service_identity_mode === "external" && <>
        <ExternalCredentialFields {...props} kind={kind} label={shortLabel} required={required} />
        {!required && <p className="settings-description">{text("optionalEnabledFeatures")}</p>}
        {!props.readOnly && <CommandExample title={text("createIdentity", { label })}>{kind === "runtime" ? RUNTIME_READ_OPS_COMMAND : SUPERVISION_OPS_COMMAND}</CommandExample>}
      </>}
    </div>}
  </SettingsItem>;
}

export default function StorageEndpointCredentialsFields(props: Props) {
  const { text } = useStorageEndpointI18n();
  const identityActionHelpId = useId();
  const [showCephAdminKeys, setShowCephAdminKeys] = useState(false);
  if (props.form.provider !== "ceph") return <UiInlineMessage tone="info">
    {props.form.provider === "aws"
      ? text("awsIdentityNotice")
      : text("providerIdentityNotice")}
  </UiInlineMessage>;
  const { form, identities, checks } = props;
  const required = serviceIdentityRequirements(form.features);
  const relevantServiceIdentity = (kind: string) => {
    const identity = identities?.find(candidate => candidate.kind === kind);
    return required[kind as ServiceKind] || Boolean(identity && identity.status !== "disabled"
      && (identity.credentials_configured || identity.rgw_uid || identity.status === "provisioning"
        || identity.status === "revocation_pending" || identity.rotation_pending));
  };
  const savedMode = identities?.find(identity => identity.kind === "runtime")?.mode;
  const modeChanged = Boolean(props.editing && savedMode && savedMode !== form.service_identity_mode);
  const plannedManagedProvisioning = form.service_identity_mode === "managed" && (required.runtime || required.supervision) && (!props.editing || modeChanged);
  const initialProvisioning = form.service_identity_mode === "managed" && Boolean(identities?.some(identity =>
    (identity.kind === "runtime" || identity.kind === "supervision") && relevantServiceIdentity(identity.kind) && identity.mode === "managed" && identity.status === "not_provisioned"
  ));
  const needsReconciliation = ["runtime", "supervision"].some(kind => {
    if (!relevantServiceIdentity(kind)) return false;
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
  const cephAdminNeedsReconciliation = Boolean(form.has_ceph_admin_secret && cephAdminIdentity
    && (cephAdminIdentity.status !== "ready" || cephAdminIdentity.last_error));
  const cephAdminKeysVisible = showCephAdminKeys || Boolean(form.ceph_admin_allowed || form.ceph_admin_access_key || form.ceph_admin_secret_key
    || props.errors.ceph_admin_access_key || props.errors.ceph_admin_secret_key);
  const cephAdminFields = <div className="settings-stack">
    <ExternalCredentialFields {...props} kind="ceph_admin" label="Ceph Admin" required={form.ceph_admin_allowed} />
    {!props.readOnly && <CommandExample title={text("createCephAdminExternally")}>{CEPH_ADMIN_COMMAND}</CommandExample>}
    <p className="settings-description">{text("cephAdminExternalHelp")}</p>
  </div>;
  return <>
    <SettingsSection title={text("administrationSection")} description={text("administrationDescription")} presentation="compact">
      <div className="settings-stack">
        {adminCheck && <div className="flex flex-wrap items-center gap-2"><CredentialStatusBadge {...adminCheck} /></div>}
        {adminCheck?.status === "misconfigured" && adminCheck.message && <UiInlineMessage tone="error">{adminCheck.message}</UiInlineMessage>}
        <CredentialFields {...props} kind="admin" label={text("adminLabel")} required={required.runtime || (form.service_identity_mode === "managed" && required.supervision)} />
        {adminCheck?.status === "valid" && permissions && <UiDetails className="settings-stack"
          defaultOpen={!permissions.users_read || !permissions.users_write || !permissions.accounts_read || !permissions.accounts_write}>
          <summary className="settings-label">{text("adminOpsPermissions")}</summary>
          <AdminOpsPermissionsBadges permissions={permissions} />
        </UiDetails>}
        {!props.readOnly && <CommandExample title={text("recommendedAdminOps")}>{ADMIN_OPS_FULL_COMMAND}</CommandExample>}
      </div>
    </SettingsSection>
    <SettingsSection title={text("serviceIdentities")} description={text("serviceIdentitiesDescription")} presentation="compact">
      <div className="settings-stack">
        <SettingsSelect label={text("identityManagement")} value={form.service_identity_mode} disabled={props.readOnly}
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
          <option value="managed">{text("managedByBucketReef")}</option>
          <option value="external">{text("providedExternally")}</option>
        </SettingsSelect>
        {modeChanged && <UiInlineMessage tone={form.service_identity_mode === "external" ? "warning" : "info"}>
          {form.service_identity_mode === "external"
            ? text("supplyKeysAndRevoke")
            : text("createNeededIdentities")}
          <p>{text("pendingSaveCurrent", { mode: savedMode === "managed" ? text("managedByBucketReef") : text("providedExternally") })}</p>
        </UiInlineMessage>}
        <div>
          <ServiceIdentityRow {...props} kind="runtime" modeChanged={modeChanged} />
          <ServiceIdentityRow {...props} kind="supervision" modeChanged={modeChanged} />
        </div>
        {(showIdentityAction || (needsReconciliation && props.configurationDirty && !initialProvisioning)) && <div className="settings-stack">
          {showIdentityAction && <div className="flex flex-wrap items-center gap-2">
            <SettingsButton variant="secondary" disabled={identityActionDisabled} onClick={props.onReconcile}
              aria-describedby={initialProvisioning && props.usersWrite !== true ? identityActionHelpId : undefined}>
              {initialProvisioning ? text("createManagedIdentities") : text("retryConfiguration")}
            </SettingsButton>
            {initialProvisioning && props.usersWrite !== true && <p id={identityActionHelpId} className="settings-description">
              {props.usersWrite === false ? text("noUsersWrite") : text("validateUsersWrite")}
            </p>}
          </div>}
          {needsReconciliation && props.configurationDirty && !initialProvisioning && <p className="settings-description">
            {text("saveOrDiscardBeforeRetry")}
          </p>}
        </div>}
        {plannedManagedProvisioning && !modeChanged && <p className="settings-description">
          {props.usersWrite === true ? text("savingCreatesIdentities") : text("saveThenValidate")}
        </p>}
        {plannedManagedProvisioning && modeChanged && props.usersWrite !== true && <p className="settings-description">
          {props.usersWrite === false ? text("saveModeRestorePermission") : text("validateAfterSaving")}
        </p>}
        <UiDetails className="settings-stack">
          <summary className="settings-label">{text("aboutServiceIdentities")}</summary>
          <p className="settings-description">{text("serviceIdentityHelp")}</p>
        </UiDetails>
      </div>
    </SettingsSection>
    <SettingsSection title={text("cephAdminSection")} description={text("cephAdminDescription")} presentation="compact">
      <div className="settings-stack">
        <SettingsItem compact title={text("allowCephAdmin")} description={text("cephAdminRequirement")}
          action={<SettingsSwitch ariaLabel={text("allowCephAdmin")} checked={form.ceph_admin_allowed}
            disabled={props.readOnly} onChange={value => props.setForm(previous => ({ ...previous, ceph_admin_allowed: value }))} />} />
        <p role="status" className="settings-description">{text("endpointAuthorization", { status: form.ceph_admin_allowed ? text("allowed") : text("notAllowed"), workspace: props.cephAdminActive ? text("active") : text("inactive") })}</p>
        {cephAdminCheck && <div className="flex flex-wrap items-center gap-2"><CredentialStatusBadge {...cephAdminCheck} /></div>}
        {cephAdminIdentity?.last_error && <UiDetails className="settings-stack">
          <summary className="settings-label">{text("diagnostics", { label: "Ceph Admin" })}</summary>
          <p className="settings-description">{cephAdminIdentity.last_error}</p>
        </UiDetails>}
        {cephAdminNeedsReconciliation && props.onReconcile && !props.configurationDirty && <div>
          <SettingsButton variant="secondary" disabled={props.reconciling} onClick={props.onReconcile}>
            {text("retryCephAdminValidation")}
          </SettingsButton>
        </div>}
        {!props.cephAdminEnabled && <p className="settings-description">{text("cephAdminDisabledGeneral")}</p>}
        {!cephAdminKeysVisible && <div><SettingsButton variant="secondary" onClick={() => setShowCephAdminKeys(true)}>
          {props.readOnly ? text("viewCephAdminCredentials") : form.has_ceph_admin_secret ? text("manageCephAdminKeys") : text("prepareCephAdminKeys")}
        </SettingsButton></div>}
        <div hidden={!cephAdminKeysVisible}>{cephAdminFields}</div>
      </div>
    </SettingsSection>
  </>;
}
