/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type DeploymentProfile = "full" | "admin" | "user" | "ceph-admin-high-security";
export type AppEnvironment = "development" | "test" | "production";
export type HardeningLevel = "pass" | "warning" | "fail";

export type ProductionReadinessFinding = {
  code: string;
  label: string;
  level: HardeningLevel;
  message: string;
};

export type ProductionReadinessResponse = {
  environment: AppEnvironment;
  profile: DeploymentProfile;
  status: HardeningLevel;
  counts: Record<HardeningLevel, number>;
  findings: ProductionReadinessFinding[];
};

export async function fetchProductionReadiness(signal?: AbortSignal): Promise<ProductionReadinessResponse> {
  const { data } = await client.get<ProductionReadinessResponse>("/admin/production-readiness", { signal });
  return data;
}
