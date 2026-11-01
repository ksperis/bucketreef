/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";
import type { OnboardingDraft } from "../../api/onboarding";
import type { StorageEndpointFeatureDetectionResult } from "../../api/storageEndpoints";
import {
  buildOnboardingApplyCredentials,
  countOnboardingSelections,
  createOnboardingDraft,
  resolveOnboardingEndpointState,
  resolveOnboardingReadiness,
  type OnboardingCredentialDraft,
} from "./onboardingFormModel";

const credentials: OnboardingCredentialDraft = {
  adminAccessKey: "admin-access",
  adminSecretKey: "admin-secret",
  supervisionAccessKey: "supervision-access",
  supervisionSecretKey: "supervision-secret",
  cephAdminAccessKey: "ceph-admin-access",
  cephAdminSecretKey: "ceph-admin-secret",
  runtimeAccessKey: "runtime-access",
  runtimeSecretKey: "runtime-secret",
  privateAccessKey: "private-access",
  privateSecretKey: "private-secret",
};

function validDetection(): StorageEndpointFeatureDetectionResult {
  return {
    admin: true,
    account: true,
    usage: true,
    metrics: true,
    warnings: [],
    http_check: { status: "valid", status_code: 200 },
    admin_ops_permissions: {
      users_read: true,
      users_write: true,
      buckets_read: false,
      buckets_write: false,
      accounts_read: true,
      accounts_write: true,
      usage_read: false,
      usage_write: false,
    },
    credential_checks: {
      admin: { status: "valid" },
      supervision: { status: "valid" },
      runtime: { status: "valid" },
      ceph_admin: { status: "valid" },
    },
  };
}

function readinessFor({
  draft = createOnboardingDraft(),
  identityMode = "managed",
  applyCredentials = credentials,
  detection = validDetection(),
  blockers = [],
}: {
  draft?: OnboardingDraft;
  identityMode?: "managed" | "external";
  applyCredentials?: OnboardingCredentialDraft;
  detection?: StorageEndpointFeatureDetectionResult;
  blockers?: string[];
} = {}) {
  return resolveOnboardingReadiness({
    draft,
    identityMode,
    state: resolveOnboardingEndpointState({
      draft,
      selectedEndpoint: null,
      identityMode,
    }),
    credentials: applyCredentials,
    endpointValidation: {
      status: "done",
      result: detection,
      error: null,
    },
    privateValidation: {
      status: "done",
      ok: true,
    },
    preview: {
      value: {
        features: [],
        changes: [],
        blockers,
        review_token: "review-token",
      },
      pending: false,
      error: "",
    },
  });
}

describe("onboarding form model", () => {
  it("owns provider-sensitive draft defaults", () => {
    expect(createOnboardingDraft()).toEqual({
      version: 2,
      endpoint_id: null,
      endpoint_url: "",
      region: "",
      force_path_style: true,
      manager: true,
      portal: false,
      private_connection: false,
      ceph_admin: false,
      supervision: true,
    });

    expect(
      createOnboardingDraft({ id: 3, provider: "ceph" }),
    ).toEqual(expect.objectContaining({ endpoint_id: 3, manager: true, supervision: true }));
    expect(
      createOnboardingDraft({ id: 4, provider: "aws" }),
    ).toEqual(expect.objectContaining({ endpoint_id: 4, manager: false, supervision: false }));
  });

  it("counts selected workflows from the canonical draft", () => {
    const draft = createOnboardingDraft();
    expect(countOnboardingSelections(draft)).toBe(2);
    expect(
      countOnboardingSelections({
        ...draft,
        portal: true,
        private_connection: true,
        ceph_admin: true,
      }),
    ).toBe(5);
  });

  it("builds managed apply credentials without unused external identities", () => {
    const draft = createOnboardingDraft();
    const state = resolveOnboardingEndpointState({
      draft,
      selectedEndpoint: null,
      identityMode: "managed",
    });

    expect(
      buildOnboardingApplyCredentials({
        draft,
        identityMode: "managed",
        state,
        credentials,
      }),
    ).toEqual({
      admin_access_key: "admin-access",
      admin_secret_key: "admin-secret",
      supervision_access_key: undefined,
      supervision_secret_key: undefined,
      service_identity_mode: "managed",
      runtime_access_key: undefined,
      runtime_secret_key: undefined,
      ceph_admin_access_key: undefined,
      ceph_admin_secret_key: undefined,
      private_access_key: "private-access",
      private_secret_key: "private-secret",
    });
  });

  it("includes selected external, Ceph Admin, and private credentials", () => {
    const draft: OnboardingDraft = {
      ...createOnboardingDraft(),
      private_connection: true,
      ceph_admin: true,
    };
    const state = resolveOnboardingEndpointState({
      draft,
      selectedEndpoint: null,
      identityMode: "external",
    });

    expect(
      buildOnboardingApplyCredentials({
        draft,
        identityMode: "external",
        state,
        credentials,
      }),
    ).toEqual({
      admin_access_key: "admin-access",
      admin_secret_key: "admin-secret",
      supervision_access_key: "supervision-access",
      supervision_secret_key: "supervision-secret",
      service_identity_mode: "external",
      runtime_access_key: "runtime-access",
      runtime_secret_key: "runtime-secret",
      ceph_admin_access_key: "ceph-admin-access",
      ceph_admin_secret_key: "ceph-admin-secret",
      private_access_key: "private-access",
      private_secret_key: "private-secret",
    });
  });

  it("centralizes readiness and account provisioning permissions", () => {
    expect(readinessFor()).toEqual({
      endpointReachable: true,
      invalidSelection: false,
      validationPending: false,
      canReview: true,
      canApply: true,
    });

    const detection = validDetection();
    detection.admin_ops_permissions.accounts_write = false;
    expect(readinessFor({ detection })).toEqual(
      expect.objectContaining({ canReview: false, canApply: false }),
    );
  });

  it("blocks review for incomplete required external credentials", () => {
    expect(
      readinessFor({
        identityMode: "external",
        applyCredentials: {
          ...credentials,
          runtimeSecretKey: "",
        },
      }),
    ).toEqual(expect.objectContaining({ canReview: false, canApply: false }));
  });

  it("keeps preview blockers separate from review readiness", () => {
    expect(readinessFor({ blockers: ["configuration_changed"] })).toEqual(
      expect.objectContaining({ canReview: true, canApply: false }),
    );
  });
});
