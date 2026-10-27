/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { MultisiteBucketScope } from "../../../api/cephMultisite";
import type { MultisiteEndpointOption } from "./multisiteUtils";

export type BucketScopeForm = {
  sourceEndpointId: string;
  destinationEndpointId: string;
  sourceBucket: string;
  sourceTenant: string;
  destinationBucket: string;
  destinationTenant: string;
};

export function initialBucketScopeForm(
  search: URLSearchParams,
  endpoints: MultisiteEndpointOption[],
  selectedEndpointId: number | null,
): BucketScopeForm {
  const requestedDestination = Number(search.get("destination_endpoint_id"));
  const destination = endpoints.find((endpoint) => endpoint.endpointId === requestedDestination)
    ?? endpoints.find((endpoint) => endpoint.endpointId === selectedEndpointId)
    ?? endpoints[0]
    ?? null;
  const requestedSource = Number(search.get("source_endpoint_id"));
  const source = endpoints.find((endpoint) => endpoint.endpointId === requestedSource && endpoint.endpointId !== destination?.endpointId)
    ?? endpoints.find((endpoint) => endpoint.endpointId !== destination?.endpointId)
    ?? null;
  const destinationBucket = search.get("bucket") ?? "";
  const destinationTenant = search.get("tenant") ?? "";
  return {
    sourceEndpointId: source ? String(source.endpointId) : "",
    destinationEndpointId: destination ? String(destination.endpointId) : "",
    sourceBucket: search.get("source_bucket") ?? destinationBucket,
    sourceTenant: search.get("source_tenant") ?? destinationTenant,
    destinationBucket,
    destinationTenant,
  };
}

export function resolveBucketScope(
  form: BucketScopeForm,
  endpoints: MultisiteEndpointOption[],
): MultisiteBucketScope | null {
  const sourceEndpointId = Number(form.sourceEndpointId);
  const destinationEndpointId = Number(form.destinationEndpointId);
  if (!Number.isInteger(sourceEndpointId) || sourceEndpointId <= 0) return null;
  if (!Number.isInteger(destinationEndpointId) || destinationEndpointId <= 0) return null;
  if (sourceEndpointId === destinationEndpointId) return null;

  const source = endpoints.find((endpoint) => endpoint.endpointId === sourceEndpointId);
  const destination = endpoints.find((endpoint) => endpoint.endpointId === destinationEndpointId);
  if (!source || !destination) return null;

  const sourceBucket = form.sourceBucket.trim();
  const destinationBucket = form.destinationBucket.trim();
  if (!sourceBucket || !destinationBucket) return null;

  const scope: MultisiteBucketScope = {
    source_endpoint_id: sourceEndpointId,
    destination_endpoint_id: destinationEndpointId,
    source_zone_id: source.zoneId,
    source_bucket: sourceBucket,
    bucket: destinationBucket,
  };
  const sourceTenant = form.sourceTenant.trim();
  const destinationTenant = form.destinationTenant.trim();
  if (sourceTenant) scope.source_tenant = sourceTenant;
  if (destinationTenant) scope.tenant = destinationTenant;
  return scope;
}
