/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { MultisiteBucketScope } from "../../../api/cephMultisite";
import type { MultisiteReplicationRoute } from "./multisiteUtils";

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
  routes: MultisiteReplicationRoute[],
  selectedEndpointId: number | null,
): BucketScopeForm {
  const requestedDestination = Number(search.get("destination_endpoint_id"));
  const requestedSource = Number(search.get("source_endpoint_id"));
  const route = routes.find(
    (candidate) => candidate.source.endpointId === requestedSource && candidate.destination.endpointId === requestedDestination,
  )
    ?? routes.find((candidate) => candidate.destination.endpointId === requestedDestination)
    ?? routes.find((candidate) => candidate.source.endpointId === requestedSource)
    ?? routes.find((candidate) => candidate.destination.endpointId === selectedEndpointId)
    ?? routes[0]
    ?? null;
  const destinationBucket = search.get("bucket") ?? "";
  const destinationTenant = search.get("tenant") ?? "";
  return {
    sourceEndpointId: route ? String(route.source.endpointId) : "",
    destinationEndpointId: route ? String(route.destination.endpointId) : "",
    sourceBucket: search.get("source_bucket") ?? destinationBucket,
    sourceTenant: search.get("source_tenant") ?? destinationTenant,
    destinationBucket,
    destinationTenant,
  };
}

export function resolveBucketScope(
  form: BucketScopeForm,
  routes: MultisiteReplicationRoute[],
): MultisiteBucketScope | null {
  const sourceEndpointId = Number(form.sourceEndpointId);
  const destinationEndpointId = Number(form.destinationEndpointId);
  if (!Number.isInteger(sourceEndpointId) || sourceEndpointId <= 0) return null;
  if (!Number.isInteger(destinationEndpointId) || destinationEndpointId <= 0) return null;
  const route = routes.find(
    (candidate) => candidate.source.endpointId === sourceEndpointId && candidate.destination.endpointId === destinationEndpointId,
  );
  if (!route) return null;

  const sourceBucket = form.sourceBucket.trim();
  const destinationBucket = form.destinationBucket.trim();
  if (!sourceBucket || !destinationBucket) return null;

  const scope: MultisiteBucketScope = {
    source_endpoint_id: sourceEndpointId,
    destination_endpoint_id: destinationEndpointId,
    source_zone_id: route.source.zoneId,
    source_bucket: sourceBucket,
    bucket: destinationBucket,
  };
  const sourceTenant = form.sourceTenant.trim();
  const destinationTenant = form.destinationTenant.trim();
  if (sourceTenant) scope.source_tenant = sourceTenant;
  if (destinationTenant) scope.tenant = destinationTenant;
  return scope;
}
