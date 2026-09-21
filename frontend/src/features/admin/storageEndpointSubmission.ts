/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { StorageEndpointPayload } from "../../api/storageEndpoints";
import {
  applyFeatureConstraints, awsIamEndpointForRegion, awsS3EndpointForRegion,
  awsStsEndpointForRegion, buildFeaturesYaml, normalizeAwsRegion, parseCoordinateInput,
  type FormState,
} from "./storageEndpointFormModel";

export type EndpointFieldErrors = Partial<Record<keyof FormState, string>>;
type Submission = { payload: StorageEndpointPayload; errors?: never } | { payload?: never; errors: EndpointFieldErrors };

/** Keep validation and the endpoint's existing credential update semantics together. */
export function buildStorageEndpointSubmission(form: FormState, editing: boolean): Submission {
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
  const features = applyFeatureConstraints(aws ? {
    ...form.features,
    sts: { ...form.features.sts, endpoint: awsStsEndpointForRegion(region) },
    iam: { ...form.features.iam, endpoint: awsIamEndpointForRegion(region) },
  } : form.features, form.provider);
  const payload: StorageEndpointPayload = {
    name: form.name.trim(), endpoint_url: endpoint, region: region || null,
    force_path_style: Boolean(form.force_path_style), verify_tls: Boolean(form.verify_tls),
    latitude, longitude, provider: form.provider, features_config: buildFeaturesYaml(features),
  };
  if (form.provider === "ceph") {
    const credentials = [
      { kind: "admin", required: features.admin.enabled, label: "Admin", reason: "admin is enabled" },
      { kind: "supervision", required: features.usage.enabled || features.metrics.enabled, label: "Supervision", reason: "usage log or metrics is enabled" },
      { kind: "ceph_admin", required: false, label: "Ceph Admin", reason: "" },
    ] as const;
    for (const { kind, required, label, reason } of credentials) {
      const accessField = `${kind}_access_key` as const;
      const secretField = `${kind}_secret_key` as const;
      const access = form[accessField].trim();
      const secret = form[secretField].trim();
      if (required && !access) errors[accessField] = `${label} access key is required when ${reason}.`;
      if (required && !editing && !secret) errors[secretField] = `${label} secret key is required when ${reason}.`;
      payload[accessField] = access || null;
      // An empty secret on edit keeps the stored value; clearing access clears both.
      if (!editing || !access || secret) payload[secretField] = secret || null;
    }
  }
  return Object.keys(errors).length ? { errors } : { payload };
}
