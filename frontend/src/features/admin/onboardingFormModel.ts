/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type {
  OnboardingApplyCredentials,
  OnboardingDraft,
  OnboardingPreview,
} from "../../api/onboarding";
import type { S3CredentialsValidationPayload } from "../../api/s3CredentialsValidation";
import type {
  StorageEndpoint,
  StorageEndpointFeatureDetectionPayload,
  StorageEndpointFeatureDetectionResult,
} from "../../api/storageEndpoints";

export type OnboardingIdentityMode = "managed" | "external";

export type OnboardingCredentialDraft = {
  adminAccessKey: string;
  adminSecretKey: string;
  supervisionAccessKey: string;
  supervisionSecretKey: string;
  cephAdminAccessKey: string;
  cephAdminSecretKey: string;
  runtimeAccessKey: string;
  runtimeSecretKey: string;
  privateAccessKey: string;
  privateSecretKey: string;
};

export function createOnboardingDraft(
  endpoint: Pick<StorageEndpoint, "id" | "provider"> | null = null,
): OnboardingDraft {
  const cephDefaults = endpoint ? endpoint.provider === "ceph" : true;
  return {
    version: 2,
    endpoint_id: endpoint?.id ?? null,
    endpoint_url: "",
    region: "",
    force_path_style: true,
    manager: cephDefaults,
    portal: false,
    private_connection: false,
    ceph_admin: false,
    supervision: cephDefaults,
  };
}

export function countOnboardingSelections(draft: OnboardingDraft): number {
  return [
    draft.manager,
    draft.portal,
    draft.private_connection,
    draft.ceph_admin,
    draft.supervision,
  ].filter(Boolean).length;
}

type ServiceIdentityKind = "runtime" | "supervision" | "ceph_admin";

export function serviceIdentity(
  endpoint: StorageEndpoint | null,
  kind: ServiceIdentityKind,
) {
  return endpoint?.service_identities.find((identity) => identity.kind === kind);
}

function hasStoredAdminCredentials(endpoint: StorageEndpoint | null): boolean {
  return Boolean(endpoint?.admin_access_key && endpoint.has_admin_secret);
}

function hasStoredServiceCredentials(
  endpoint: StorageEndpoint | null,
  kind: ServiceIdentityKind,
): boolean {
  return Boolean(serviceIdentity(endpoint, kind)?.credentials_configured);
}

type OnboardingEndpointState = {
  isCeph: boolean;
  endpointConfigured: boolean;
  storedAdminCredentials: boolean;
  storedSupervisionCredentials: boolean;
  storedCephAdminCredentials: boolean;
  storedRuntimeCredentials: boolean;
  needsRuntime: boolean;
  needsSupervision: boolean;
  needsServiceIdentities: boolean;
  needsAdmin: boolean;
  managedServicesReady: boolean;
  adminCredentialsRequired: boolean;
  supervisionCredentialsRequired: boolean;
  runtimeCredentialsRequired: boolean;
  validationEndpointUrl: string;
  validationRegion: string | null;
  validationForcePathStyle: boolean;
  validationVerifyTls: boolean;
};

export function resolveOnboardingEndpointState({
  draft,
  selectedEndpoint,
  identityMode,
}: {
  draft: OnboardingDraft;
  selectedEndpoint: StorageEndpoint | null;
  identityMode: OnboardingIdentityMode;
}): OnboardingEndpointState {
  const isCeph = draft.endpoint_id ? selectedEndpoint?.provider === "ceph" : true;
  const endpointConfigured = Boolean(
    draft.endpoint_id || (draft.endpoint_url && validEndpointUrl(draft.endpoint_url)),
  );
  const storedAdminCredentials = hasStoredAdminCredentials(selectedEndpoint);
  const storedSupervisionCredentials = hasStoredServiceCredentials(
    selectedEndpoint,
    "supervision",
  );
  const storedCephAdminCredentials = hasStoredServiceCredentials(
    selectedEndpoint,
    "ceph_admin",
  );
  const storedRuntimeCredentials = hasStoredServiceCredentials(selectedEndpoint, "runtime");
  const needsRuntime = Boolean(isCeph && (draft.manager || draft.portal));
  const needsSupervision = Boolean(isCeph && draft.supervision);
  const needsServiceIdentities = needsRuntime || needsSupervision;
  const needsAdmin = needsRuntime || (identityMode === "managed" && needsSupervision);
  const managedServicesReady =
    (!needsRuntime ||
      (serviceIdentity(selectedEndpoint, "runtime")?.mode === "managed" &&
        serviceIdentity(selectedEndpoint, "runtime")?.status === "ready")) &&
    (!needsSupervision ||
      (serviceIdentity(selectedEndpoint, "supervision")?.mode === "managed" &&
        serviceIdentity(selectedEndpoint, "supervision")?.status === "ready"));

  return {
    isCeph,
    endpointConfigured,
    storedAdminCredentials,
    storedSupervisionCredentials,
    storedCephAdminCredentials,
    storedRuntimeCredentials,
    needsRuntime,
    needsSupervision,
    needsServiceIdentities,
    needsAdmin,
    managedServicesReady,
    adminCredentialsRequired: needsAdmin && !storedAdminCredentials,
    supervisionCredentialsRequired:
      identityMode === "external" && needsSupervision && !storedSupervisionCredentials,
    runtimeCredentialsRequired:
      identityMode === "external" && needsRuntime && !storedRuntimeCredentials,
    validationEndpointUrl: (selectedEndpoint?.endpoint_url ?? draft.endpoint_url).trim(),
    validationRegion: (selectedEndpoint?.region ?? draft.region)?.trim() || null,
    validationForcePathStyle:
      selectedEndpoint?.force_path_style ?? draft.force_path_style,
    validationVerifyTls: selectedEndpoint?.verify_tls ?? true,
  };
}

export function buildOnboardingEndpointValidationPayload({
  draft,
  selectedEndpoint,
  identityMode,
  state,
  credentials,
}: {
  draft: OnboardingDraft;
  selectedEndpoint: StorageEndpoint | null;
  identityMode: OnboardingIdentityMode;
  state: OnboardingEndpointState;
  credentials: OnboardingCredentialDraft;
}): StorageEndpointFeatureDetectionPayload | null {
  if (!state.endpointConfigured || !state.validationEndpointUrl) return null;

  return {
    endpoint_id: draft.endpoint_id,
    endpoint_url: state.validationEndpointUrl,
    region: state.validationRegion,
    verify_tls: state.validationVerifyTls,
    check_http: true,
    admin_access_key: state.needsAdmin
      ? credentials.adminAccessKey.trim() ||
        (state.storedAdminCredentials ? selectedEndpoint?.admin_access_key ?? null : null)
      : null,
    admin_secret_key: state.needsAdmin
      ? credentials.adminSecretKey.trim() || null
      : null,
    supervision_access_key:
      identityMode === "external" && state.needsSupervision
        ? credentials.supervisionAccessKey.trim() || null
        : null,
    supervision_secret_key:
      identityMode === "external" && state.needsSupervision
        ? credentials.supervisionSecretKey.trim() || null
        : null,
    ceph_admin_access_key: draft.ceph_admin
      ? credentials.cephAdminAccessKey.trim() || null
      : null,
    ceph_admin_secret_key: draft.ceph_admin
      ? credentials.cephAdminSecretKey.trim() || null
      : null,
    runtime_access_key:
      identityMode === "external" && state.needsRuntime
        ? credentials.runtimeAccessKey.trim() || null
        : null,
    runtime_secret_key:
      identityMode === "external" && state.needsRuntime
        ? credentials.runtimeSecretKey.trim() || null
        : null,
  };
}

export function buildOnboardingPrivateValidationPayload({
  draft,
  state,
  credentials,
}: {
  draft: OnboardingDraft;
  state: OnboardingEndpointState;
  credentials: OnboardingCredentialDraft;
}): S3CredentialsValidationPayload | null {
  const accessKey = credentials.privateAccessKey.trim();
  const secretKey = credentials.privateSecretKey.trim();
  if (!draft.private_connection || !accessKey || !secretKey || !state.endpointConfigured) {
    return null;
  }
  if (draft.endpoint_id) {
    return {
      storage_endpoint_id: draft.endpoint_id,
      access_key_id: accessKey,
      secret_access_key: secretKey,
    };
  }
  return {
    endpoint_url: state.validationEndpointUrl,
    region: state.validationRegion,
    force_path_style: state.validationForcePathStyle,
    verify_tls: state.validationVerifyTls,
    access_key_id: accessKey,
    secret_access_key: secretKey,
  };
}

export function buildOnboardingApplyCredentials({
  draft,
  identityMode,
  state,
  credentials,
}: {
  draft: OnboardingDraft;
  identityMode: OnboardingIdentityMode;
  state: OnboardingEndpointState;
  credentials: OnboardingCredentialDraft;
}): OnboardingApplyCredentials {
  return {
    admin_access_key: state.needsAdmin ? credentials.adminAccessKey || undefined : undefined,
    admin_secret_key: state.needsAdmin ? credentials.adminSecretKey || undefined : undefined,
    supervision_access_key:
      identityMode === "external" && state.needsSupervision
        ? credentials.supervisionAccessKey || undefined
        : undefined,
    supervision_secret_key:
      identityMode === "external" && state.needsSupervision
        ? credentials.supervisionSecretKey || undefined
        : undefined,
    service_identity_mode: identityMode,
    runtime_access_key:
      identityMode === "external" && state.needsRuntime
        ? credentials.runtimeAccessKey || undefined
        : undefined,
    runtime_secret_key:
      identityMode === "external" && state.needsRuntime
        ? credentials.runtimeSecretKey || undefined
        : undefined,
    ceph_admin_access_key: draft.ceph_admin
      ? credentials.cephAdminAccessKey || undefined
      : undefined,
    ceph_admin_secret_key: draft.ceph_admin
      ? credentials.cephAdminSecretKey || undefined
      : undefined,
    private_access_key: credentials.privateAccessKey || undefined,
    private_secret_key: credentials.privateSecretKey || undefined,
  };
}

type OnboardingValidationStatus = "idle" | "loading" | "done";

type OnboardingReadiness = {
  endpointReachable: boolean;
  invalidSelection: boolean;
  validationPending: boolean;
  canReview: boolean;
  canApply: boolean;
};

export function resolveOnboardingReadiness({
  draft,
  identityMode,
  state,
  credentials,
  endpointValidation,
  privateValidation,
  preview,
}: {
  draft: OnboardingDraft;
  identityMode: OnboardingIdentityMode;
  state: OnboardingEndpointState;
  credentials: OnboardingCredentialDraft;
  endpointValidation: {
    status: OnboardingValidationStatus;
    result: StorageEndpointFeatureDetectionResult | null;
    error: string | null;
  };
  privateValidation: {
    status: OnboardingValidationStatus;
    ok: boolean;
  };
  preview: {
    value: OnboardingPreview | null;
    pending: boolean;
    error: string;
  };
}): OnboardingReadiness {
  const result = endpointValidation.result;
  const endpointReachable = result?.http_check.status === "valid";
  const invalidSelection =
    !state.isCeph && (draft.manager || draft.portal || draft.ceph_admin || draft.supervision);
  const adminCredentialsPartial =
    state.adminCredentialsRequired &&
    Boolean(credentials.adminAccessKey) !== Boolean(credentials.adminSecretKey);
  const supervisionCredentialsPartial =
    state.supervisionCredentialsRequired &&
    Boolean(credentials.supervisionAccessKey) !== Boolean(credentials.supervisionSecretKey);
  const runtimeCredentialsPartial =
    state.runtimeCredentialsRequired &&
    Boolean(credentials.runtimeAccessKey) !== Boolean(credentials.runtimeSecretKey);
  const adminCredentialsMissing =
    state.adminCredentialsRequired &&
    (!credentials.adminAccessKey || !credentials.adminSecretKey);
  const supervisionCredentialsMissing =
    state.supervisionCredentialsRequired &&
    (!credentials.supervisionAccessKey || !credentials.supervisionSecretKey);
  const runtimeCredentialsMissing =
    state.runtimeCredentialsRequired &&
    (!credentials.runtimeAccessKey || !credentials.runtimeSecretKey);
  const privateCredentialsMissing =
    draft.private_connection && (!credentials.privateAccessKey || !credentials.privateSecretKey);
  const adminCredentialStatus = result?.credential_checks.admin.status ?? "not_configured";
  const supervisionCredentialStatus =
    result?.credential_checks.supervision.status ?? "not_configured";
  const cephAdminCredentialStatus =
    result?.credential_checks.ceph_admin?.status ?? "not_configured";
  const runtimeCredentialStatus = result?.credential_checks.runtime?.status ?? "not_configured";
  const adminValidationReady =
    !state.needsAdmin ||
    (adminCredentialStatus === "valid" &&
      result?.admin === true &&
      (!(draft.manager || draft.portal) ||
        (result.account === true && hasAccountProvisioningPermissions(result.admin_ops_permissions))));
  const supervisionValidationReady =
    !state.needsSupervision ||
    identityMode === "managed" ||
    (supervisionCredentialStatus === "valid" && result?.metrics === true);
  const cephAdminValidationReady =
    !draft.ceph_admin ||
    (cephAdminCredentialStatus === "valid" &&
      Boolean(credentials.cephAdminAccessKey) === Boolean(credentials.cephAdminSecretKey) &&
      (Boolean(credentials.cephAdminAccessKey && credentials.cephAdminSecretKey) ||
        state.storedCephAdminCredentials));
  const runtimeValidationReady =
    identityMode === "managed" || !state.needsRuntime || runtimeCredentialStatus === "valid";
  const privateValidationReady =
    !draft.private_connection || (privateValidation.status === "done" && privateValidation.ok);
  const validationPending =
    endpointValidation.status === "loading" ||
    (draft.private_connection && privateValidation.status === "loading");
  const canReview = Boolean(
    endpointReachable &&
      endpointValidation.status === "done" &&
      !endpointValidation.error &&
      countOnboardingSelections(draft) > 0 &&
      !invalidSelection &&
      !adminCredentialsPartial &&
      !supervisionCredentialsPartial &&
      !runtimeCredentialsPartial &&
      !adminCredentialsMissing &&
      !supervisionCredentialsMissing &&
      !runtimeCredentialsMissing &&
      !privateCredentialsMissing &&
      adminValidationReady &&
      supervisionValidationReady &&
      cephAdminValidationReady &&
      runtimeValidationReady &&
      privateValidationReady &&
      !validationPending,
  );
  const canApply = Boolean(
    canReview &&
      preview.value &&
      !preview.pending &&
      !preview.error &&
      preview.value.blockers.length === 0,
  );

  return {
    endpointReachable,
    invalidSelection,
    validationPending,
    canReview,
    canApply,
  };
}

function hasAccountProvisioningPermissions(
  permissions: StorageEndpointFeatureDetectionResult["admin_ops_permissions"],
): boolean {
  return Boolean(
    permissions.users_read &&
      permissions.users_write &&
      permissions.accounts_read &&
      permissions.accounts_write,
  );
}

function validEndpointUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}
