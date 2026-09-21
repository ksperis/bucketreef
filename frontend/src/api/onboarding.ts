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
  journeys?: OnboardingJourney[];
  endpoints?: OnboardingOption[];
  accounts?: OnboardingOption[];
  connections?: OnboardingOption[];
  users?: OnboardingOption[];
  can_configure?: boolean;
  actor_id?: number;
  spaces?: { id: string; name: string; account_id: number }[];
};

export type OnboardingIntent = "evaluate" | "personal" | "organization";
export type OnboardingWorkspace = "browser" | "manager" | "portal" | "ceph-admin";
export type OnboardingCheck = "usage" | "backup" | "restore" | "updates" | "identities" | "ownership" | "pilot_allowed" | "pilot_denied" | "isolation";
export type OnboardingOption = { id: number; name: string; endpoint_id?: number | null; provider?: string | null; is_shared?: boolean };
export type OnboardingPreview = { features: string[]; changes: string[]; blockers: string[]; review_token: string };

export type OnboardingDraft = {
  intent: OnboardingIntent;
  workspace: OnboardingWorkspace;
  name: string;
  resource_kind: "connection" | "account" | "endpoint";
  beneficiary_user_id: number | null;
  endpoint_id: number | null;
  connection_id: number | null;
  account_id: number | null;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  grant_access: boolean;
  bucket: string;
  prefix: string;
  space_id: string;
  space_name: string;
  space_visibility: "private" | "shared";
};

export type OnboardingEvidence = {
  source?: "automatic" | "operator";
  actor_id?: number;
  at?: string;
  operation?: string;
  current?: boolean;
  checked?: boolean;
  note?: string;
};

export type OnboardingJourney = {
  id: string;
  revision: number;
  draft: OnboardingDraft;
  resources: { endpoint_id?: number; account_id?: number; connection_id?: number; space_id?: string; rgw_account_id?: string };
  evidence: OnboardingEvidence;
  readiness: Partial<Record<OnboardingCheck, OnboardingEvidence>>;
  pending_step: string | null;
  configured: boolean;
  usage_validated: boolean;
  ready: boolean;
  preview: OnboardingPreview;
  open_url: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const { data } = await client.get<OnboardingStatus>("/admin/onboarding");
  return data;
}

export async function dismissOnboarding(): Promise<OnboardingStatus> {
  const { data } = await client.post<OnboardingStatus>("/admin/onboarding/dismiss");
  return data;
}

export async function resumeOnboarding(): Promise<OnboardingStatus> {
  const { data } = await client.post<OnboardingStatus>("/admin/onboarding/resume");
  return data;
}

export async function saveOnboardingJourney(id: string, draft: OnboardingDraft, revision?: number): Promise<OnboardingJourney> {
  const { data } = await client.put<OnboardingJourney>(`/admin/onboarding/journeys/${id}`, { draft, revision });
  return data;
}

export async function applyOnboardingJourney(journey: OnboardingJourney, credentials: { access_key?: string; secret_key?: string }): Promise<OnboardingJourney> {
  const { data } = await client.post<OnboardingJourney>(`/admin/onboarding/journeys/${journey.id}/apply`, {
    revision: journey.revision, confirmed: true, review_token: journey.preview.review_token, ...credentials,
  }, { timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS });
  return data;
}

export async function verifyOnboardingJourney(journey: OnboardingJourney): Promise<OnboardingJourney> {
  const { data } = await client.post<OnboardingJourney>(`/admin/onboarding/journeys/${journey.id}/verify`, { revision: journey.revision }, { timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS });
  return data;
}

export async function previewOnboardingDraft(draft: OnboardingDraft, signal?: AbortSignal, journeyId?: string): Promise<OnboardingPreview> {
  const { data } = await client.post<OnboardingPreview>("/admin/onboarding/preview", draft, { signal, params: { journey_id: journeyId } });
  return data;
}

export async function attestOnboardingJourney(journey: OnboardingJourney, check: OnboardingCheck, checked: boolean, note: string): Promise<OnboardingJourney> {
  const { data } = await client.post<OnboardingJourney>(`/admin/onboarding/journeys/${journey.id}/attest`, { revision: journey.revision, check, checked, note });
  return data;
}
