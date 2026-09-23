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
  StorageEndpointFeatureDetectionPayload,
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
  validateAdminS3ConnectionCredentials: vi.fn(),
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
vi.mock("../../api/s3ConnectionsAdmin", () => ({
  validateAdminS3ConnectionCredentials: mocks.validateAdminS3ConnectionCredentials,
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
  admin_access_key: "admin-key",
  has_admin_secret: true,
  has_supervision_secret: false,
  ceph_admin_access_key: "ceph-admin-key",
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
  admin_access_key: null,
  has_admin_secret: false,
  ceph_admin_access_key: null,
  has_ceph_admin_secret: false,
} as StorageEndpoint;

function previewFor(draft: OnboardingDraft): OnboardingPreview {
  const features: string[] = [];
  const changes: string[] = [];
  const blockers: string[] = [];
  if (!draft.endpoint_id && !draft.endpoint_url) blockers.push("endpoint_required");
  if (
    !draft.manager &&
    !draft.portal &&
    !draft.private_connection &&
    !draft.ceph_admin &&
    !draft.supervision
  ) {
    blockers.push("selection_required");
  }
  if (draft.manager) changes.push("grant_manager_access");
  if (draft.portal) changes.push("grant_portal_access", "prepare_portal_identity");
  if (draft.private_connection) changes.push("create_private_connection");
  if (draft.ceph_admin) changes.push("grant_ceph_admin_access");
  if (draft.supervision) changes.push("validate_supervision", "enable_endpoint_supervision_features");
  return { review_token: REVIEW_TOKEN, features, changes, blockers };
}

function detectionFor(
  payload: StorageEndpointFeatureDetectionPayload,
): StorageEndpointFeatureDetectionResult {
  const credentialCheck = (accessKey?: string | null) =>
    accessKey
      ? { status: "valid" as const, message: "Access validated." }
      : { status: "not_configured" as const };
  return {
    admin: Boolean(payload.admin_access_key),
    account: Boolean(payload.admin_access_key),
    usage: Boolean(payload.supervision_access_key),
    metrics: Boolean(payload.supervision_access_key),
    warnings: [],
    admin_ops_permissions: {
      users_read: Boolean(payload.admin_access_key),
      users_write: Boolean(payload.admin_access_key),
      buckets_read: false,
      buckets_write: false,
      accounts_read: Boolean(payload.admin_access_key),
      accounts_write: Boolean(payload.admin_access_key),
    },
    http_check: {
      status: "valid",
      status_code: 200,
      message: "Endpoint responded over HTTP (200).",
    },
    credential_checks: {
      admin: credentialCheck(payload.admin_access_key),
      supervision: credentialCheck(payload.supervision_access_key),
      ceph_admin: credentialCheck(payload.ceph_admin_access_key),
    },
  };
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

async function continueWhenReady() {
  const button = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
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
  mocks.detectStorageEndpointFeatures.mockImplementation(
    async (payload: StorageEndpointFeatureDetectionPayload) => detectionFor(payload),
  );
  mocks.validateAdminS3ConnectionCredentials.mockResolvedValue({
    ok: true,
    severity: "success",
    code: null,
    message: "Credentials validated.",
  });
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
  it("uses four clear steps and keeps endpoint connection credential-free", async () => {
    renderPage();

    expect(await screen.findByRole("tab", { name: "1. Connect storage" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "2. Prepare BucketReef" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "3. Credentials" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "4. Review" })).toBeDisabled();
    expect(screen.queryByLabelText(/Admin Ops access key/)).not.toBeInTheDocument();
    expect(screen.queryByText("Detected capabilities")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Endpoint" }), { target: { value: "3" } });
    const continueButton = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    expect(await screen.findByRole("checkbox", { name: /Manager with a sample RGW Account/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Portal with the same sample account/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Private S3 connection/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Enable monitoring \/ metrics/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Ceph Admin/ })).toBeEnabled();
    expect(screen.getAllByText("Recommended")).toHaveLength(2);
    expect(screen.getByText("Experimental")).toBeInTheDocument();
    expect(mocks.saveOnboardingJourney).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ endpoint_id: 3, manager: true, portal: false, supervision: true }),
      undefined,
    );
  });

  it("requests only missing credentials and shows RGW creation help for each selected identity", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: "S3 endpoint URL" }), {
      target: { value: "https://new-ceph.example.test" },
    });
    await continueWhenReady();

    await screen.findByRole("checkbox", { name: /Manager with a sample RGW Account/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /^Ceph Admin/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Private S3 connection/ }));
    await continueWhenReady();

    expect(await screen.findByRole("tab", { name: "3. Credentials" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Admin Ops access key")).toBeRequired();
    expect(screen.getByLabelText("Supervision Ops access key")).toBeRequired();
    expect(screen.getByLabelText("Ceph Admin access key")).toBeRequired();
    expect(screen.getByLabelText("Private S3 access key")).toBeRequired();
    expect(screen.getAllByText("Keys are never stored in onboarding progress.")).toHaveLength(1);
    expect(
      screen.getAllByText("Show the Ceph RGW command to create this identity"),
    ).toHaveLength(4);
    expect(screen.getByText(/users=read,write;accounts=read,write;buckets=write/)).toBeInTheDocument();
    expect(screen.getByText(/usage=read;buckets=read/)).toBeInTheDocument();
    expect(screen.getByText(/--admin/)).toBeInTheDocument();
    expect(screen.getByText(/BucketReef private S3 user/)).toBeInTheDocument();
  });

  it("requires Admin Ops provisioning caps while keeping bucket quota capability optional", async () => {
    let accountsWrite = false;
    mocks.detectStorageEndpointFeatures.mockImplementation(
      async (payload: StorageEndpointFeatureDetectionPayload) => {
        const result = detectionFor(payload);
        if (payload.admin_access_key) {
          result.admin_ops_permissions.accounts_write = accountsWrite;
        }
        return result;
      },
    );

    renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: "S3 endpoint URL" }), {
      target: { value: "https://caps.example.test" },
    });
    await continueWhenReady();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Enable monitoring \/ metrics/ }));
    await continueWhenReady();

    fireEvent.change(await screen.findByLabelText("Admin Ops access key"), {
      target: { value: "admin-access" },
    });
    fireEvent.change(screen.getByLabelText("Admin Ops secret key"), {
      target: { value: "admin-secret" },
    });

    expect(await screen.findByText("× Accounts cap · missing read/write")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    accountsWrite = true;
    fireEvent.change(screen.getByLabelText("Admin Ops secret key"), {
      target: { value: "admin-secret-2" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.getByText("✓ Accounts cap · read/write")).toBeInTheDocument();
    expect(screen.getByText("Bucket quotas · optional cap not granted")).toBeInTheDocument();
  });

  it("requires bucket stats and non-empty usage data for supervision", async () => {
    let usageHasData = false;
    mocks.detectStorageEndpointFeatures.mockImplementation(
      async (payload: StorageEndpointFeatureDetectionPayload) => {
        const result = detectionFor(payload);
        if (payload.supervision_access_key) {
          result.usage = usageHasData;
          result.usage_error = usageHasData
            ? null
            : "RGW usage logs returned no data. Verify rgw_enable_usage_log is enabled and that RGW has recorded traffic.";
        }
        return result;
      },
    );

    renderPage();
    fireEvent.change(await screen.findByRole("combobox", { name: "Endpoint" }), {
      target: { value: "3" },
    });
    await continueWhenReady();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Manager with a sample RGW Account/ }));
    await continueWhenReady();

    fireEvent.change(await screen.findByLabelText("Supervision Ops access key"), {
      target: { value: "supervision-access" },
    });
    fireEvent.change(screen.getByLabelText("Supervision Ops secret key"), {
      target: { value: "supervision-secret" },
    });

    expect(await screen.findByText("✓ Bucket stats · available")).toBeInTheDocument();
    expect(screen.getByText("! Usage data · no values")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    usageHasData = true;
    fireEvent.change(screen.getByLabelText("Supervision Ops secret key"), {
      target: { value: "supervision-secret-2" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.getByText("✓ Usage data · available")).toBeInTheDocument();
  });

  it("reuses complete stored endpoint credentials instead of asking for them again", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("combobox", { name: "Endpoint" }), { target: { value: "3" } });
    await continueWhenReady();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Enable monitoring \/ metrics/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Ceph Admin/ }));
    await continueWhenReady();

    expect(
      await screen.findAllByText(
        "Credentials are already configured on this endpoint and will be reused.",
      ),
    ).toHaveLength(2);
    expect(screen.queryByLabelText("Admin Ops access key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ceph Admin access key")).not.toBeInTheDocument();
  });

  it("keeps private S3 credentials out of draft/preview and applies them only on confirmation", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("combobox", { name: "Endpoint" }), { target: { value: "4" } });
    await continueWhenReady();

    const privateOption = await screen.findByRole("checkbox", { name: /Private S3 connection/ });
    expect(privateOption).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Manager with a sample RGW Account/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Ceph Admin/ })).toBeDisabled();
    fireEvent.click(privateOption);
    await continueWhenReady();

    fireEvent.change(await screen.findByLabelText("Private S3 access key"), { target: { value: "private-access" } });
    fireEvent.change(screen.getByLabelText("Private S3 secret key"), { target: { value: "private-secret" } });

    const credentialsContinue = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(credentialsContinue).toBeEnabled());
    expect(JSON.stringify(mocks.previewOnboardingDraft.mock.calls)).not.toContain("private-secret");
    expect(JSON.stringify(mocks.saveOnboardingJourney.mock.calls)).not.toContain("private-secret");
    fireEvent.click(credentialsContinue);

    expect(await screen.findByRole("tab", { name: "4. Review" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Review before applying" })).toBeInTheDocument();
    expect(screen.getByText("Credentials for your private connection")).toBeInTheDocument();
    const applyButton = screen.getByRole("button", { name: "Apply configuration" });
    await waitFor(() => expect(applyButton).toBeEnabled());

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
    await continueWhenReady();

    await screen.findByRole("checkbox", { name: /Private S3 connection/ });
    expect(screen.getAllByText("This option requires a Ceph RGW endpoint.").length).toBeGreaterThanOrEqual(4);
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
      supervision: false,
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
      supervision: false,
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
