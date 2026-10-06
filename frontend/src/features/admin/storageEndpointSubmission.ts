/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { StorageEndpoint, StorageEndpointPayload } from "../../api/storageEndpoints";
import {
  applyFeatureConstraints, awsIamEndpointForRegion, awsS3EndpointForRegion,
  awsStsEndpointForRegion, buildFeaturesYaml, normalizeAwsRegion, parseCoordinateInput,
  serviceIdentityRequirements, type FormState,
} from "./storageEndpointFormModel";

export type EndpointFieldErrors = Partial<Record<keyof FormState, string>>;
type Submission = { payload: StorageEndpointPayload; errors?: never } | { payload?: never; errors: EndpointFieldErrors };

/** Keep validation and the endpoint's existing credential update semantics together. */
export function buildStorageEndpointSubmission(form: FormState, editing: boolean, storedIdentities?: StorageEndpoint["service_identities"]): Submission {
  const errors: EndpointFieldErrors = {};
  const aws = form.provider === "aws";
  const region = aws ? normalizeAwsRegion(form.region) : form.region.trim();
  const endpoint = aws ? awsS3EndpointForRegion(region) : form.endpoint_url.trim();
  if (!form.name.trim()) errors.name = "Endpoint name is required.";
  if (!endpoint) errors.endpoint_url = "Endpoint URL is required.";
  let latitude: number | null = null;
  let longitude: number | null = null;
  for (const [field, label, min, max] of [["latitude", "Latitude", -90, 90], ["longitude", "Longitude", -180, 180]] as const) {
    try {
      const value = parseCoordinateInput(form[field], label, min, max);
      if (field === "latitude") latitude = value;
      else longitude = value;
    } catch (error) {
      errors[field] = error instanceof Error ? error.message : "Invalid coordinates.";
    }
  }
  const constrainedFeatures = applyFeatureConstraints(aws ? {
    ...form.features,
    sts: { ...form.features.sts, endpoint: awsStsEndpointForRegion(region) },
    iam: { ...form.features.iam, endpoint: awsIamEndpointForRegion(region) },
  } : form.features, form.provider);
  const externalSupervisionConfigured = form.provider === "ceph"
    && form.service_identity_mode === "external"
    && Boolean(
      (form.supervision_access_key.trim() && form.supervision_secret_key.trim())
      || (editing && form.has_supervision_secret
        && !form.supervision_access_key.trim() && !form.supervision_secret_key.trim()),
    );
  const features = externalSupervisionConfigured ? {
    ...constrainedFeatures,
    healthcheck: { ...constrainedFeatures.healthcheck, enabled: true, mode: "s3" as const },
  } : constrainedFeatures;
  const payload: StorageEndpointPayload = {
    name: form.name.trim(), endpoint_url: endpoint, region: region || null,
    force_path_style: Boolean(form.force_path_style), verify_tls: Boolean(form.verify_tls),
    latitude, longitude, provider: form.provider, features_config: buildFeaturesYaml(features),
  };
  if (form.provider === "ceph") {
    payload.service_identity_mode = form.service_identity_mode;
    payload.ceph_admin_allowed = form.ceph_admin_allowed;
    const external = form.service_identity_mode === "external";
    const requiredIdentities = serviceIdentityRequirements(features);
    const replacementRequired = (kind: "runtime" | "supervision") => Boolean(external && storedIdentities?.some(identity =>
      identity.kind === kind && identity.mode === "managed"
      && (identity.credentials_configured || identity.rgw_uid || identity.status === "provisioning" || identity.status === "revocation_pending")
    ));
    const credentials = [
      { kind: "admin", required: requiredIdentities.runtime || (!external && requiredIdentities.supervision), label: "Admin", reason: "administration or managed identity creation is enabled" },
      { kind: "runtime", required: external && (requiredIdentities.runtime || replacementRequired("runtime")), label: "Runtime Read Ops", reason: "Admin or Accounts is enabled or a managed identity is being replaced" },
      { kind: "ceph_admin", required: form.ceph_admin_allowed, label: "Ceph Admin", reason: "Ceph Admin is allowed" },
      { kind: "supervision", required: external && (requiredIdentities.supervision || replacementRequired("supervision")), label: "Supervision", reason: "Metrics, Usage or an S3 signed healthcheck is enabled or a managed identity is being replaced" },
    ] as const;
    for (const { kind, required, label, reason } of credentials) {
      if (!external && kind !== "admin" && kind !== "ceph_admin") continue;
      const accessField = `${kind}_access_key` as const;
      const secretField = `${kind}_secret_key` as const;
      const access = form[accessField].trim();
      const secret = form[secretField].trim();
      const replacingManaged = (kind === "runtime" || kind === "supervision") && replacementRequired(kind);
      const storedCredentials = editing && form[`has_${kind}_secret`] && !replacingManaged;
      if (kind !== "admin" && storedCredentials && !access && !secret) {
        continue;
      }
      if (kind !== "admin" && Boolean(access) !== Boolean(secret)) {
        if (!access) errors[accessField] = `${label} access key is required when replacing stored credentials.`;
        if (!secret) errors[secretField] = `${label} secret key is required when replacing stored credentials.`;
        continue;
      }
      if (kind === "admin" && Boolean(access) !== Boolean(secret) && !(access && editing && form.has_admin_secret)) {
        if (!access) errors[accessField] = "Admin access key is required when supplying credentials.";
        if (!secret) errors[secretField] = "Admin secret key is required when supplying credentials.";
        continue;
      }
      if (required && !access) errors[accessField] = `${label} access key is required when ${reason}.`;
      if (required && !storedCredentials && !secret) errors[secretField] = `${label} secret key is required when ${reason}.`;
      payload[accessField] = access || null;
      // Admin Ops keeps its historical access-key-visible edit contract. Service
      // identities replace their write-only credential pair atomically.
      if (kind !== "admin" || !editing || !access || secret) payload[secretField] = secret || null;
    }
  }
  return Object.keys(errors).length ? { errors } : { payload };
}
