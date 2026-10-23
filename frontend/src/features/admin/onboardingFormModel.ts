/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { OnboardingDraft } from "../../api/onboarding";
import type { S3CredentialsValidationPayload } from "../../api/s3CredentialsValidation";
import type {
  StorageEndpoint,
  StorageEndpointFeatureDetectionPayload,
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

function validEndpointUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}
