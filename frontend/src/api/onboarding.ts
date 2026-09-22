/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS } from "./client";

export type OnboardingStatus = {
  dismissed: boolean;
  complete: boolean;
  endpoint_configured: boolean;
  storage_access_configured: boolean;
  source?: "quickstart" | "standard";
  journeys: OnboardingJourney[];
  can_configure: boolean;
  actor_id: number;
};

export type OnboardingPreview = {
  features: string[];
  changes: string[];
  blockers: string[];
  review_token: string;
};

export type OnboardingDraft = {
  version: 2;
  endpoint_id: number | null;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  manager: boolean;
  portal: boolean;
  private_connection: boolean;
  ceph_admin: boolean;
  supervision: boolean;
};

export type OnboardingJourney = {
  id: string;
  revision: number;
  draft: OnboardingDraft;
  resources: {
    endpoint_id?: number;
    endpoint_name?: string;
    account_id?: number;
    account_name?: string;
    connection_id?: number;
    rgw_account_id?: string;
  };
  pending_step: string | null;
  configured: boolean;
  preview: OnboardingPreview;
  links: Partial<Record<"manager" | "portal" | "browser" | "private_manager" | "ceph_admin", string>>;
  created_at: string;
  updated_at: string;
};

type OnboardingApplyCredentials = {
  admin_access_key?: string;
  admin_secret_key?: string;
  supervision_access_key?: string;
  supervision_secret_key?: string;
  ceph_admin_access_key?: string;
  ceph_admin_secret_key?: string;
  private_access_key?: string;
  private_secret_key?: string;
};

export const ONBOARDING_STATUS_EVENT = "bucketreef:onboarding-status";

export function announceOnboardingStatus(status: OnboardingStatus): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<OnboardingStatus>(ONBOARDING_STATUS_EVENT, { detail: status }));
  }
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const { data } = await client.get<OnboardingStatus>("/admin/onboarding");
  return data;
}

export async function dismissOnboarding(): Promise<OnboardingStatus> {
  const { data } = await client.post<OnboardingStatus>("/admin/onboarding/dismiss");
  announceOnboardingStatus(data);
  return data;
}

export async function resumeOnboarding(): Promise<OnboardingStatus> {
  const { data } = await client.post<OnboardingStatus>("/admin/onboarding/resume");
  announceOnboardingStatus(data);
  return data;
}

export async function saveOnboardingJourney(
  id: string,
  draft: OnboardingDraft,
  revision?: number,
): Promise<OnboardingJourney> {
  const { data } = await client.put<OnboardingJourney>(`/admin/onboarding/journeys/${id}`, { draft, revision });
  return data;
}

export async function applyOnboardingJourney(
  journey: OnboardingJourney,
  credentials: OnboardingApplyCredentials,
): Promise<OnboardingJourney> {
  const { data } = await client.post<OnboardingJourney>(
    `/admin/onboarding/journeys/${journey.id}/apply`,
    {
      revision: journey.revision,
      confirmed: true,
      review_token: journey.preview.review_token,
      ...credentials,
    },
    { timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS },
  );
  return data;
}

export async function previewOnboardingDraft(
  draft: OnboardingDraft,
  signal?: AbortSignal,
  journeyId?: string,
): Promise<OnboardingPreview> {
  const { data } = await client.post<OnboardingPreview>("/admin/onboarding/preview", draft, {
    signal,
    params: { journey_id: journeyId },
  });
  return data;
}
