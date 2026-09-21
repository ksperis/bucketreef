/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingDraft, OnboardingJourney, OnboardingPreview, OnboardingStatus } from "../../api/onboarding";
import OnboardingPage from "./OnboardingPage";

const api = vi.hoisted(() => ({
  fetchOnboardingStatus: vi.fn(), previewOnboardingDraft: vi.fn(), saveOnboardingJourney: vi.fn(),
  applyOnboardingJourney: vi.fn(), verifyOnboardingJourney: vi.fn(), attestOnboardingJourney: vi.fn(),
  resumeOnboarding: vi.fn(),
  refreshSettings: vi.fn(), refreshSession: vi.fn(),
}));
vi.mock("../../api/onboarding", () => api);
vi.mock("../../components/GeneralSettingsContext", () => ({ useGeneralSettings: () => ({ refresh: api.refreshSettings }) }));
vi.mock("../../auth/SessionProvider", () => ({ useSession: () => ({ refresh: api.refreshSession }) }));

let state: OnboardingStatus;
const reviewToken = "a".repeat(64);
function preview(draft: OnboardingDraft): OnboardingPreview {
  return {
    review_token: reviewToken, features: draft.workspace === "portal" ? ["portal_enabled", "browser_enabled", "browser_portal_enabled"] : [],
    changes: draft.connection_id ? [] : ["create_private_connection"],
    blockers: !draft.connection_id && !draft.endpoint_id && !draft.endpoint_url ? ["endpoint_required"] : [],
  };
}
function saved(id: string, draft: OnboardingDraft, revision = 1): OnboardingJourney {
  return { id, revision, draft, resources: {}, evidence: {}, readiness: {}, pending_step: null,
    configured: false, usage_validated: false, ready: false, preview: preview(draft), open_url: null,
    created_at: "2026-09-21T12:00:00Z", updated_at: "2026-09-21T12:00:00Z" };
}
function existingDraft(patch: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return { name: "Saved scope", intent: "evaluate", workspace: "browser", resource_kind: "connection",
    beneficiary_user_id: null, endpoint_id: 3, connection_id: 5, account_id: null,
    endpoint_url: "", region: "", force_path_style: true, grant_access: false,
    bucket: "allowed-bucket", prefix: "", space_id: "", space_name: "", space_visibility: "private", ...patch };
}
function page() { return render(<MemoryRouter initialEntries={["/admin/onboarding"]}><OnboardingPage /></MemoryRouter>); }

beforeEach(() => {
  vi.clearAllMocks();
  state = { dismissed: false, complete: false, endpoint_configured: true, storage_access_configured: false,
    can_configure: true, actor_id: 1, journeys: [], source: "quickstart",
    endpoints: [{ id: 3, name: "Lab S3", provider: "ceph" }], connections: [], accounts: [],
    users: [{ id: 1, name: "Administrator" }, { id: 2, name: "Client pilot" }], spaces: [],
  };
  api.fetchOnboardingStatus.mockImplementation(async () => state);
  api.resumeOnboarding.mockImplementation(async () => { state = { ...state, dismissed: false }; return state; });
  api.previewOnboardingDraft.mockImplementation(async (draft: OnboardingDraft) => preview(draft));
  api.saveOnboardingJourney.mockImplementation(async (id: string, draft: OnboardingDraft, revision?: number) => {
    const journey = saved(id, draft, revision ?? 1); state.journeys = [journey]; return journey;
  });
  api.applyOnboardingJourney.mockImplementation(async (journey: OnboardingJourney) => {
    const result = { ...journey, configured: true, draft: { ...journey.draft, connection_id: 5 },
      resources: { connection_id: 5 }, preview: { features: [], changes: [], blockers: [], review_token: reviewToken },
      open_url: `/${journey.draft.workspace}?ctx=conn-5` };
    state.journeys = [result]; return result;
  });
  api.verifyOnboardingJourney.mockImplementation(async (journey: OnboardingJourney) => {
    const result = { ...journey, usage_validated: true, evidence: { source: "automatic" as const, current: true, operation: "list_buckets" } };
    state.journeys = [result]; return result;
  });
  api.refreshSettings.mockResolvedValue(undefined); api.refreshSession.mockResolvedValue(null);
});

describe("guided onboarding", () => {
  it("restores the dashboard entry when the administrator explicitly reopens the guide", async () => {
    state.dismissed = true;
    page();
    await screen.findByRole("heading", { name: "How will you use BucketReef?" });
    expect(api.resumeOnboarding).toHaveBeenCalledTimes(1);
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
  });
  it("presents all four goals and keeps QuickStart optional (a11y)", async () => {
    const { container } = page();
    expect(await screen.findByRole("heading", { name: "How will you use BucketReef?" })).toBeInTheDocument();
    expect(screen.getByText(/Recommended after QuickStart/)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("radio", { name: /Manager.*teams and clients/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Portal.*teams and clients/ })).toBeInTheDocument();
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("configures Manager directly, sends keys only on confirmation, then runs an explicit check", async () => {
    page();
    fireEvent.click(await screen.findByRole("radio", { name: /Manager —/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue", exact: true }));
    await screen.findByRole("combobox", { name: "Storage endpoint" });
    fireEvent.change(screen.getByRole("combobox", { name: "Storage endpoint" }), { target: { value: "3" } });
    fireEvent.change(await screen.findByLabelText("Access key", { exact: true }), { target: { value: "test-access" } });
    fireEvent.change(screen.getByLabelText("Secret key", { exact: true }), { target: { value: "test-secret" } });
    const submit = screen.getByRole("button", { name: "Configure and continue" });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
    expect(JSON.stringify(api.previewOnboardingDraft.mock.calls)).not.toContain("test-secret");
    fireEvent.click(submit);
    await screen.findByText("Configured", { selector: "span" });
    expect(api.applyOnboardingJourney).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ workspace: "manager" }) }), { access_key: "test-access", secret_key: "test-secret" });
    expect(JSON.stringify(api.saveOnboardingJourney.mock.calls)).not.toContain("test-secret");
    expect(api.verifyOnboardingJourney).not.toHaveBeenCalled();
    expect(api.refreshSettings).toHaveBeenCalled(); expect(api.refreshSession).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check access with this profile" }));
    expect(await screen.findByText("Usage validated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", "/manager?ctx=conn-5");
  });

  it("shows ENV blockers and never applies a disabled journey", async () => {
    api.previewOnboardingDraft.mockResolvedValue({ features: [], changes: [], blockers: ["env_locked:FEATURE_BROWSER_ENABLED"], review_token: reviewToken });
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Continue", exact: true }));
    expect(await screen.findByText(/FEATURE_BROWSER_ENABLED/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure and continue" })).toBeDisabled();
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
  });

  it("retains a saved goal on reload and keeps setup separate from real use", async () => {
    const draft = { intent: "organization", workspace: "manager", resource_kind: "connection", connection_id: 5,
      account_id: null, endpoint_id: 3, beneficiary_user_id: null, name: "Client scope", endpoint_url: "", region: "",
      force_path_style: true, grant_access: false, bucket: "allowed-bucket", prefix: "", space_id: "", space_name: "", space_visibility: "private" } as OnboardingDraft;
    state.journeys = [{ ...saved("aa", draft), configured: true, open_url: "/manager?ctx=conn-5" }];
    page();
    await screen.findByText("Usage still to be checked");
    expect(screen.queryByText("Usage validated")).not.toBeInTheDocument();
    expect(api.verifyOnboardingJourney).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "2. Configuration" }));
    expect(await screen.findByLabelText("Known bucket (optional)")).toHaveValue("allowed-bucket");
    await waitFor(() => expect(api.previewOnboardingDraft).toHaveBeenCalled());
    expect(api.fetchOnboardingStatus).toHaveBeenCalledTimes(1);
  });

  it("preserves the configuration and shows the denial after a failed check", async () => {
    const draft = { intent: "evaluate", workspace: "browser", resource_kind: "connection", connection_id: 5,
      name: "Private scope", beneficiary_user_id: null } as OnboardingDraft;
    state.journeys = [{ ...saved("saved", draft), configured: true, open_url: "/browser?ctx=conn-5" }];
    api.verifyOnboardingJourney.mockRejectedValue({ isApiError: true, response: { status: 400, data: { detail: { code: "storage_access_denied" } } } });
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Check access with this profile" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/Storage denied this operation/)).toBeInTheDocument();
    expect(screen.getByText("Usage still to be checked")).toBeInTheDocument();
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
  });

  it("retains a compatible private connection when switching from Browser to Manager", async () => {
    const draft = { intent: "personal", workspace: "browser", resource_kind: "connection", connection_id: 5,
      endpoint_id: 3, name: "Existing scope", beneficiary_user_id: null, bucket: "limited-bucket", prefix: "docs/",
      account_id: null, endpoint_url: "", region: "", force_path_style: true, grant_access: false,
      space_id: "", space_name: "", space_visibility: "private" } as OnboardingDraft;
    state.connections = [{ id: 5, name: "Existing scope", endpoint_id: 3, is_shared: false }];
    state.journeys = [{ ...saved("existing", draft), configured: true, open_url: "/browser?ctx=conn-5" }];
    page();
    await screen.findByText("Usage still to be checked");
    fireEvent.click(screen.getByRole("tab", { name: "1. Your goal" }));
    fireEvent.click(screen.getByRole("radio", { name: /Manager —/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue", exact: true }));
    expect(await screen.findByRole("combobox", { name: "S3 connection" })).toHaveValue("5");
    expect(screen.getByLabelText("Known bucket (optional)")).toHaveValue("limited-bucket");
    expect(api.saveOnboardingJourney).toHaveBeenLastCalledWith("existing", expect.objectContaining({
      workspace: "manager", connection_id: 5, endpoint_id: 3, prefix: "", grant_access: false,
    }), 1);
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
  });

  it("keeps credential fields mounted while reviewing edits and blocks a failed or pending preview", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Continue", exact: true }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Storage endpoint" }), { target: { value: "3" } });
    const access = await screen.findByLabelText("Access key", { exact: true });
    const secret = screen.getByLabelText("Secret key", { exact: true });
    fireEvent.change(access, { target: { value: "test-access" } });
    fireEvent.change(secret, { target: { value: "test-secret" } });
    const submit = screen.getByRole("button", { name: "Configure and continue" });
    await waitFor(() => expect(submit).toBeEnabled());
    let rejectPreview!: (cause: Error) => void;
    api.previewOnboardingDraft.mockImplementationOnce(() => new Promise((_, reject) => { rejectPreview = reject; }));
    fireEvent.change(screen.getByLabelText("Known bucket (optional)"), { target: { value: "limited-bucket" } });
    expect(screen.getByLabelText("Access key", { exact: true })).toBe(access);
    expect(screen.getByLabelText("Secret key", { exact: true })).toBe(secret);
    expect(secret).toHaveValue("test-secret");
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
    await waitFor(() => expect(rejectPreview).toBeDefined());
    await act(async () => rejectPreview(new Error("preview unavailable")));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Setup could not complete/);
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
    expect(secret).toHaveValue("test-secret");
    fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("retains unsaved edits after a save failure and guards a reload", async () => {
    state.connections = [{ id: 5, name: "Saved scope", endpoint_id: 3, is_shared: false }];
    state.journeys = [saved("saved", existingDraft())];
    page();
    fireEvent.change(await screen.findByLabelText("Name", { exact: true }), { target: { value: "My edited scope" } });
    api.saveOnboardingJourney.mockRejectedValueOnce(new Error("network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save and leave" })).toBeEnabled());
    expect(screen.getByLabelText("Name", { exact: true })).toHaveValue("My edited scope");
    expect(screen.getByText("Changes not saved yet")).toBeInTheDocument();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("saves a new edited goal before starting another one", async () => {
    page();
    fireEvent.click(await screen.findByRole("radio", { name: /Manager —/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add another goal" }));
    await waitFor(() => expect(api.saveOnboardingJourney).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ workspace: "manager" }), undefined));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Browser —/ })).toBeChecked());
    expect(api.applyOnboardingJourney).not.toHaveBeenCalled();
  });

  it("keeps the Portal space choice consistent after changing project or beneficiary", async () => {
    state.accounts = [{ id: 7, name: "Existing project", endpoint_id: 3 }];
    page();
    fireEvent.click(await screen.findByRole("radio", { name: /Portal —/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue", exact: true }));
    expect(await screen.findByLabelText("New space name")).toHaveValue("My files");
    expect(screen.getByRole("combobox", { name: "Who can access this space?" })).toHaveValue("private");
    fireEvent.change(screen.getByRole("combobox", { name: "Ceph RGW account / project" }), { target: { value: "7" } });
    expect(screen.queryByLabelText("New space name")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "First file space" })).toHaveValue("later");
    fireEvent.change(screen.getByRole("combobox", { name: "First file space" }), { target: { value: "new" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Profile receiving this access" }), { target: { value: "2" } });
    expect(screen.queryByLabelText("New space name")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Profile receiving this access" }), { target: { value: "" } });
    expect(screen.getByRole("combobox", { name: "First file space" })).toHaveValue("later");
    expect(screen.queryByLabelText("New space name")).not.toBeInTheDocument();
  });

  it("offers space selection instead of a failing Portal check when no space is configured", async () => {
    const draft = existingDraft({ workspace: "portal", resource_kind: "account", account_id: 7, connection_id: null });
    state.accounts = [{ id: 7, name: "Existing project", endpoint_id: 3 }];
    state.journeys = [{ ...saved("portal", draft), configured: true, open_url: "/portal?project=7" }];
    page();
    expect(await screen.findByRole("button", { name: "Choose a space to check" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Check access with this profile" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose a space to check" }));
    expect(await screen.findByRole("combobox", { name: "First file space" })).toHaveValue("later");
    expect(api.verifyOnboardingJourney).not.toHaveBeenCalled();
  });

  it("keeps the evaluation focused on the read check and opens manual evidence on demand", async () => {
    state.journeys = [{ ...saved("evaluation", existingDraft()), configured: true, open_url: "/browser?ctx=conn-5" }];
    const { container } = page();
    await screen.findByText("Usage still to be checked");
    const note = screen.getByLabelText("Observed result and tested profiles (never include credentials)");
    expect(note).not.toBeVisible();
    expect(screen.queryByRole("heading", { name: "Before keeping or opening this service" })).not.toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("places the required pilot evidence next to the readiness checks", async () => {
    const journey = { ...saved("organization", existingDraft({ intent: "organization", workspace: "manager" })), configured: true, open_url: "/manager?ctx=conn-5" };
    state.journeys = [journey];
    api.attestOnboardingJourney.mockResolvedValue(journey);
    page();
    const allowed = await screen.findByRole("checkbox", { name: "Allowed operations succeed with pilot profiles" });
    expect(allowed).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Pilot test results (no credentials)"), { target: { value: "Client pilot listed only its assigned bucket." } });
    expect(allowed).toBeEnabled();
    fireEvent.click(allowed);
    await waitFor(() => expect(api.attestOnboardingJourney).toHaveBeenCalledWith(journey, "pilot_allowed", true, "Client pilot listed only its assigned bucket."));
  });
});
