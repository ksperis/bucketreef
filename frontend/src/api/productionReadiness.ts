/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type DeploymentProfile = "full" | "admin" | "user" | "ceph-admin-high-security";
export type AppEnvironment = "development" | "test" | "production";
type CheckResult = "pass" | "fail" | "manual";
type CheckSeverity = "blocker" | "critical" | "warning";
export type CheckLevel = "blocked" | "critical" | "warning" | "manual" | "ok";
export type ReadinessStatus = "blocked" | "critical" | "warning" | "ok";

export type ProductionReadinessFinding = {
  code: string;
  label: string;
  result: CheckResult;
  severity: CheckSeverity | null;
  level: CheckLevel;
  message: string;
  documentation_url: string;
  blocks_startup: boolean;
};

export type ProductionReadinessResponse = {
  environment: AppEnvironment;
  profile: DeploymentProfile;
  status: ReadinessStatus;
  counts: Record<CheckLevel, number>;
  findings: ProductionReadinessFinding[];
};

export async function fetchProductionReadiness(signal?: AbortSignal): Promise<ProductionReadinessResponse> {
  const { data } = await client.get<ProductionReadinessResponse>("/admin/production-readiness", { signal });
  return data;
}
