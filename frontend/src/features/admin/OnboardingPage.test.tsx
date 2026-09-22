/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OnboardingDraft,
  OnboardingJourney,
  OnboardingPreview,
  OnboardingStatus,
} from "../../api/onboarding";
import type {
  StorageEndpoint,
  StorageEndpointFeatureDetectionResult,
} from "../../api/storageEndpoints";
import OnboardingPage from "./OnboardingPage";

const mocks = vi.hoisted(() => ({
  announceOnboardingStatus: vi.fn(),
  applyOnboardingJourney: vi.fn(),
  detectStorageEndpointFeatures: vi.fn(),
  dismissOnboarding: vi.fn(),
  fetchOnboardingStatus: vi.fn(),
  listStorageEndpoints: vi.fn(),
  previewOnboardingDraft: vi.fn(),
  refreshSession: vi.fn(),
  refreshSettings: vi.fn(),
  resumeOnboarding: vi.fn(),
  saveOnboardingJourney: vi.fn(),
}));

vi.mock("../../api/onboarding", () => ({
  ONBOARDING_STATUS_EVENT: "bucketreef:onboarding-status",
  announceOnboardingStatus: mocks.announceOnboardingStatus,
  applyOnboardingJourney: mocks.applyOnboardingJourney,
  dismissOnboarding: mocks.dismissOnboarding,
  fetchOnboardingStatus: mocks.fetchOnboardingStatus,
  previewOnboardingDraft: mocks.previewOnboardingDraft,
  resumeOnboarding: mocks.resumeOnboarding,
  saveOnboardingJourney: mocks.saveOnboardingJourney,
}));
vi.mock("../../api/storageEndpoints", () => ({
  detectStorageEndpointFeatures: mocks.detectStorageEndpointFeatures,
  listStorageEndpoints: mocks.listStorageEndpoints,
}));
vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({ refresh: mocks.refreshSettings }),
}));
vi.mock("../../auth/SessionProvider", () => ({
  useSession: () => ({ refresh: mocks.refreshSession }),
}));
vi.mock("../../auth/useRecentWebAuthnStepUp", () => ({
  isRecentWebAuthnVerificationCancelled: () => false,
  useRecentWebAuthnStepUp: () => ({
    runWithStepUp: async (action: () => Promise<unknown>) => action(),
    verificationDialog: null,
  }),
}));

const REVIEW_TOKEN = "a".repeat(64);
const createdAt = "2026-09-22T12:00:00Z";
let status: OnboardingStatus;
let lastJourney: OnboardingJourney | null;

const cephEndpoint = {
  id: 3,
  name: "Lab Ceph",
  endpoint_url: "https://s3.example.test",
  region: "default",
  force_path_style: true,
  verify_tls: true,
  provider: "ceph",
  has_admin_secret: true,
  has_supervision_secret: false,
  has_ceph_admin_secret: true,
  features: {},
  is_default: true,
  is_editable: true,
  tags: [],
  created_at: createdAt,
  updated_at: createdAt,
} as StorageEndpoint;

const awsEndpoint = {
  ...cephEndpoint,
  id: 4,
  name: "External S3",
  endpoint_url: "https://s3.external.test",
  provider: "other",
  has_admin_secret: false,
  has_ceph_admin_secret: false,
} as StorageEndpoint;

const validDetection: StorageEndpointFeatureDetectionResult = {
  admin: true,
  account: true,
  usage: true,
  metrics: true,
  warnings: [],
  credential_checks: {
    admin: { status: "valid", message: "Admin credentials validated" },
    supervision: { status: "not_configured" },
    ceph_admin: { status: "valid", message: "Ceph Admin identity validated" },
  },
};

function previewFor(draft: OnboardingDraft): OnboardingPreview {
  const features: string[] = [];
  const changes: string[] = [];
  const blockers: string[] = [];
  if (!draft.endpoint_id && !draft.endpoint_url) blockers.push("endpoint_required");
  if (!draft.manager && !draft.portal && !draft.private_connection && !draft.ceph_admin) {
    blockers.push("selection_required");
  }
  if (draft.manager) changes.push("grant_manager_access");
  if (draft.portal) changes.push("grant_portal_access", "prepare_portal_identity");
  if (draft.private_connection) changes.push("create_private_connection");
  if (draft.ceph_admin) changes.push("grant_ceph_admin_access");
  return { review_token: REVIEW_TOKEN, features, changes, blockers };
}

function journey(id: string, draft: OnboardingDraft, configured = false): OnboardingJourney {
  return {
    id,
    revision: 1,
    draft,
    resources: {},
    pending_step: null,
    configured,
    preview: configured ? { review_token: "", features: [], changes: [], blockers: [] } : previewFor(draft),
    links: {},
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/onboarding"]}>
      <OnboardingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lastJourney = null;
  status = {
    dismissed: false,
    complete: false,
    endpoint_configured: true,
    storage_access_configured: false,
    source: "standard",
    journeys: [],
    can_configure: true,
    actor_id: 1,
  };
  mocks.fetchOnboardingStatus.mockImplementation(async () => status);
  mocks.listStorageEndpoints.mockResolvedValue([cephEndpoint, awsEndpoint]);
  mocks.detectStorageEndpointFeatures.mockResolvedValue(validDetection);
  mocks.previewOnboardingDraft.mockImplementation(async (draft: OnboardingDraft) => previewFor(draft));
  mocks.saveOnboardingJourney.mockImplementation(async (id: string, draft: OnboardingDraft) => {
    lastJourney = journey(id, draft);
    status = { ...status, complete: false, journeys: [lastJourney] };
    return lastJourney;
  });
  mocks.applyOnboardingJourney.mockImplementation(async (current: OnboardingJourney) => {
    const result: OnboardingJourney = {
      ...current,
      configured: true,
      resources: {
        endpoint_id: current.draft.endpoint_id ?? 9,
        ...(current.draft.manager || current.draft.portal ? { account_id: 11 } : {}),
        ...(current.draft.private_connection ? { connection_id: 12 } : {}),
      },
      preview: { review_token: "", features: [], changes: [], blockers: [] },
      links: {
        ...(current.draft.manager ? { manager: "/manager/buckets?ctx=11" } : {}),
        ...(current.draft.portal ? { portal: "/portal/storage-spaces?project=11" } : {}),
        ...(current.draft.private_connection
          ? {
              browser: "/browser?ctx=conn-12",
              private_manager: "/manager/buckets?ctx=conn-12",
            }
          : {}),
        ...(current.draft.ceph_admin ? { ceph_admin: "/ceph-admin?ep=3" } : {}),
      },
    };
    lastJourney = result;
    status = { ...status, complete: true, journeys: [result] };
    return result;
  });
  mocks.dismissOnboarding.mockImplementation(async () => {
    status = { ...status, dismissed: true };
    return status;
  });
  mocks.resumeOnboarding.mockImplementation(async () => {
    status = { ...status, dismissed: false };
    return status;
  });
  mocks.refreshSettings.mockResolvedValue(undefined);
  mocks.refreshSession.mockResolvedValue(undefined);
});

describe("simplified onboarding", () => {
  it("uses two clear steps and preselects Manager + Portal when Ceph account capabilities are available", async () => {
    renderPage();

    expect(await screen.findByRole("tab", { name: "1. Connect storage" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "2. Prepare BucketReef" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Endpoint" }), { target: { value: "3" } });
    await waitFor(() => expect(mocks.detectStorageEndpointFeatures).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("Available").length).toBeGreaterThanOrEqual(3));

    const continueButton = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    expect(await screen.findByRole("checkbox", { name: /Manager with a sample RGW Account/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Portal with the same sample account/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Private S3 connection/ })).not.toBeChecked();
    expect(mocks.saveOnboardingJourney).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ endpoint_id: 3, manager: true, portal: true }),
      undefined,
    );
  });

  it("keeps private S3 credentials out of draft/preview and applies them only on confirmation", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("combobox", { name: "Endpoint" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const privateOption = await screen.findByRole("checkbox", { name: /Private S3 connection/ });
    expect(privateOption).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Manager with a sample RGW Account/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Ceph Admin/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Access key"), { target: { value: "private-access" } });
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "private-secret" } });

    const applyButton = screen.getByRole("button", { name: "Apply configuration" });
    await waitFor(() => expect(applyButton).toBeEnabled());
    expect(JSON.stringify(mocks.previewOnboardingDraft.mock.calls)).not.toContain("private-secret");
    expect(JSON.stringify(mocks.saveOnboardingJourney.mock.calls)).not.toContain("private-secret");

    fireEvent.click(applyButton);
    expect(await screen.findByRole("heading", { name: "BucketReef is ready to explore" })).toBeInTheDocument();
    expect(mocks.applyOnboardingJourney).toHaveBeenCalledWith(
      expect.objectContaining({ draft: expect.objectContaining({ private_connection: true }) }),
      expect.objectContaining({
        private_access_key: "private-access",
        private_secret_key: "private-secret",
      }),
    );
    expect(screen.getByRole("link", { name: "Open Browser" })).toHaveAttribute("href", "/browser?ctx=conn-12");
    expect(screen.getByRole("link", { name: "Open private connection in Manager" })).toHaveAttribute(
      "href",
      "/manager/buckets?ctx=conn-12",
    );
    expect(mocks.refreshSettings).toHaveBeenCalled();
    expect(mocks.refreshSession).toHaveBeenCalled();
  });

  it("shows why Ceph-specific choices are unavailable on a generic S3 endpoint", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("combobox", { name: "Endpoint" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("checkbox", { name: /Private S3 connection/ });
    expect(screen.getAllByText("This option requires a Ceph RGW endpoint.").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("checkbox", { name: /Private S3 connection/ })).toBeEnabled();
  });

  it("does not silently restore a dismissed assistant", async () => {
    status = { ...status, dismissed: true };
    renderPage();

    expect(await screen.findByRole("heading", { name: "Setup assistant is hidden" })).toBeInTheDocument();
    expect(mocks.resumeOnboarding).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show setup assistant" }));
    await waitFor(() => expect(mocks.resumeOnboarding).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("tab", { name: "1. Connect storage" })).toBeInTheDocument();
  });

  it("resumes an incomplete v2 setup at the preparation step", async () => {
    const draft: OnboardingDraft = {
      version: 2,
      endpoint_id: 3,
      endpoint_url: "",
      region: "",
      force_path_style: true,
      manager: true,
      portal: false,
      private_connection: false,
      ceph_admin: false,
    };
    status = { ...status, journeys: [journey("saved", draft)] };
    renderPage();

    expect(await screen.findByRole("tab", { name: "2. Prepare BucketReef" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: /Manager with a sample RGW Account/ })).toBeChecked();
  });

  it("turns a completed setup into a new active journey when the assistant is run again", async () => {
    const completedDraft: OnboardingDraft = {
      version: 2,
      endpoint_id: 3,
      endpoint_url: "",
      region: "",
      force_path_style: true,
      manager: true,
      portal: false,
      private_connection: false,
      ceph_admin: false,
    };
    status = { ...status, complete: true, journeys: [journey("completed", completedDraft, true)] };
    renderPage();

    fireEvent.change(await screen.findByRole("combobox", { name: "Endpoint" }), { target: { value: "3" } });
    const continueButton = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    await waitFor(() => expect(status.complete).toBe(false));
    await waitFor(() => expect(mocks.announceOnboardingStatus).toHaveBeenCalledWith(
      expect.objectContaining({ complete: false }),
    ));
    expect(await screen.findByRole("tab", { name: "2. Prepare BucketReef" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the first-run surface accessible", async () => {
    const { container } = renderPage();
    await screen.findByRole("tab", { name: "1. Connect storage" });
    expect((await axe(container)).violations).toEqual([]);
  });
});
