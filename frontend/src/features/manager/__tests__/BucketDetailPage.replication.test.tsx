import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { transferableAbortController } from "node:util";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BucketDetailPage from "../BucketDetailPage";
import { setSessionUserCache } from "../../../utils/workspaces";

const useS3AccountContextMock = vi.fn();
const useCephAdminEndpointMock = vi.fn();
const getBucketStatsMock = vi.fn();
const getBucketVersioningMock = vi.fn();
const getBucketObjectLockMock = vi.fn();
const getBucketLifecycleMock = vi.fn();
const getBucketEncryptionMock = vi.fn();
const getBucketNotificationsMock = vi.fn();
const getBucketLoggingMock = vi.fn();
const getBucketWebsiteMock = vi.fn();
const getBucketReplicationMock = vi.fn();
const getBucketPolicyMock = vi.fn();
const getBucketAclMock = vi.fn();
const getBucketCorsMock = vi.fn();
const getBucketTagsMock = vi.fn();
const getBucketPublicAccessBlockMock = vi.fn();
const putBucketLifecycleMock = vi.fn();
const listManagerObjectsMock = vi.fn();
const listCephAdminBucketObjectsMock = vi.fn();
const listCephAdminBucketsMock = vi.fn();
const getCephAdminBucketPropertiesMock = vi.fn();
const getCephAdminBucketVersioningMock = vi.fn();
const getCephAdminBucketObjectLockMock = vi.fn();
const getCephAdminBucketLifecycleMock = vi.fn();
const getCephAdminBucketEncryptionMock = vi.fn();
const getCephAdminBucketNotificationsMock = vi.fn();
const getCephAdminBucketLoggingMock = vi.fn();
const getCephAdminBucketWebsiteMock = vi.fn();
const getCephAdminBucketReplicationMock = vi.fn();
const getCephAdminBucketPolicyMock = vi.fn();
const getCephAdminBucketAclMock = vi.fn();
const getCephAdminBucketCorsMock = vi.fn();
const getCephAdminBucketTagsMock = vi.fn();
const getCephAdminBucketPublicAccessBlockMock = vi.fn();
const putCephAdminBucketLifecycleMock = vi.fn();
const setCephAdminBucketVersioningMock = vi.fn();
const updateCephAdminBucketObjectLockMock = vi.fn();
const fetchCephAdminClusterTrafficMock = vi.fn();
const deleteCephAdminBucketReplicationMock = vi.fn();
const putCephAdminBucketReplicationMock = vi.fn();
const putBucketCorsMock = vi.fn();
const putCephAdminBucketCorsMock = vi.fn();

vi.mock("../../../api/bucketDetails", async () => {
  const actual = await vi.importActual<typeof import("../../../api/bucketDetails")>("../../../api/bucketDetails");
  return {
    ...actual,
    getBucketStats: (...args: unknown[]) => getBucketStatsMock(...args),
    getBucketVersioning: (...args: unknown[]) => getBucketVersioningMock(...args),
    getBucketObjectLock: (...args: unknown[]) => getBucketObjectLockMock(...args),
    getBucketLifecycle: (...args: unknown[]) => getBucketLifecycleMock(...args),
    getBucketEncryption: (...args: unknown[]) => getBucketEncryptionMock(...args),
    getBucketNotifications: (...args: unknown[]) => getBucketNotificationsMock(...args),
    getBucketLogging: (...args: unknown[]) => getBucketLoggingMock(...args),
    getBucketWebsite: (...args: unknown[]) => getBucketWebsiteMock(...args),
    getBucketReplication: (...args: unknown[]) => getBucketReplicationMock(...args),
    getBucketPolicy: (...args: unknown[]) => getBucketPolicyMock(...args),
    getBucketAcl: (...args: unknown[]) => getBucketAclMock(...args),
    getBucketCors: (...args: unknown[]) => getBucketCorsMock(...args),
    putBucketCors: (...args: unknown[]) => putBucketCorsMock(...args),
    getBucketTags: (...args: unknown[]) => getBucketTagsMock(...args),
    getBucketPublicAccessBlock: (...args: unknown[]) => getBucketPublicAccessBlockMock(...args),
    putBucketLifecycle: (...args: unknown[]) => putBucketLifecycleMock(...args),
  };
});

vi.mock("../../../api/cephAdminBuckets", async () => {
  const actual = await vi.importActual<typeof import("../../../api/cephAdminBuckets")>("../../../api/cephAdminBuckets");
  return {
    ...actual,
    listCephAdminBuckets: (...args: unknown[]) => listCephAdminBucketsMock(...args),
  };
});

vi.mock("../../../api/cephAdminBucketDetails", async () => {
  const actual = await vi.importActual<typeof import("../../../api/cephAdminBucketDetails")>(
    "../../../api/cephAdminBucketDetails",
  );
  return {
    ...actual,
    listCephAdminBucketObjects: (...args: unknown[]) => listCephAdminBucketObjectsMock(...args),
    getCephAdminBucketProperties: (...args: unknown[]) => getCephAdminBucketPropertiesMock(...args),
    getCephAdminBucketVersioning: (...args: unknown[]) => getCephAdminBucketVersioningMock(...args),
    getCephAdminBucketObjectLock: (...args: unknown[]) => getCephAdminBucketObjectLockMock(...args),
    getCephAdminBucketLifecycle: (...args: unknown[]) => getCephAdminBucketLifecycleMock(...args),
    getCephAdminBucketEncryption: (...args: unknown[]) => getCephAdminBucketEncryptionMock(...args),
    getCephAdminBucketNotifications: (...args: unknown[]) => getCephAdminBucketNotificationsMock(...args),
    getCephAdminBucketLogging: (...args: unknown[]) => getCephAdminBucketLoggingMock(...args),
    getCephAdminBucketWebsite: (...args: unknown[]) => getCephAdminBucketWebsiteMock(...args),
    getCephAdminBucketReplication: (...args: unknown[]) => getCephAdminBucketReplicationMock(...args),
    getCephAdminBucketPolicy: (...args: unknown[]) => getCephAdminBucketPolicyMock(...args),
    getCephAdminBucketAcl: (...args: unknown[]) => getCephAdminBucketAclMock(...args),
    getCephAdminBucketCors: (...args: unknown[]) => getCephAdminBucketCorsMock(...args),
    putCephAdminBucketCors: (...args: unknown[]) => putCephAdminBucketCorsMock(...args),
    getCephAdminBucketTags: (...args: unknown[]) => getCephAdminBucketTagsMock(...args),
    getCephAdminBucketPublicAccessBlock: (...args: unknown[]) => getCephAdminBucketPublicAccessBlockMock(...args),
    putCephAdminBucketLifecycle: (...args: unknown[]) => putCephAdminBucketLifecycleMock(...args),
    setCephAdminBucketVersioning: (...args: unknown[]) => setCephAdminBucketVersioningMock(...args),
    updateCephAdminBucketObjectLock: (...args: unknown[]) => updateCephAdminBucketObjectLockMock(...args),
    deleteCephAdminBucketReplication: (...args: unknown[]) => deleteCephAdminBucketReplicationMock(...args),
    putCephAdminBucketReplication: (...args: unknown[]) => putCephAdminBucketReplicationMock(...args),
  };
});

vi.mock("../../../api/cephAdminMetrics", () => ({
  fetchCephAdminClusterTraffic: (...args: unknown[]) =>
    fetchCephAdminClusterTrafficMock(...args),
}));

vi.mock("../../../api/managerObjects", async () => {
  const actual = await vi.importActual<typeof import("../../../api/managerObjects")>("../../../api/managerObjects");
  return {
    ...actual,
    listManagerObjects: (...args: unknown[]) => listManagerObjectsMock(...args),
  };
});

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../cephAdmin/CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

function managerCephAccountContext(accountId: string) {
  return {
    accounts: [
      {
        id: accountId,
        endpoint_provider: "ceph",
        storage_endpoint_capabilities: {
          metrics: true,
          replication: true,
          sns: true,
          sse: true,
          static_website: true,
        },
      },
    ],
    selectedS3AccountId: accountId,
    accountIdForApi: accountId,
    requiresS3AccountSelection: true,
    accessMode: "admin",
    managerBucketQuotaEnabled: true,
  };
}

describe("BucketDetailPage replication state", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    setSessionUserCache(null);
    window.localStorage.clear();
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: false,
      accessMode: "admin",
      managerBucketQuotaEnabled: false,
    });
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
          replication: true,
          sns: true,
        },
      },
    });
    getBucketStatsMock.mockResolvedValue({ name: "demo-bucket", used_bytes: null, object_count: null });
    getBucketVersioningMock.mockResolvedValue({ status: "Disabled", enabled: false });
    getBucketObjectLockMock.mockResolvedValue({ enabled: false, mode: null, days: null, years: null });
    getBucketLifecycleMock.mockResolvedValue({ rules: [] });
    getBucketEncryptionMock.mockResolvedValue({ rules: [] });
    getBucketNotificationsMock.mockResolvedValue({ configuration: {} });
    getBucketLoggingMock.mockResolvedValue({ enabled: false });
    getBucketWebsiteMock.mockResolvedValue(null);
    getBucketPolicyMock.mockResolvedValue({ policy: null });
    getBucketAclMock.mockResolvedValue({ owner: "owner", grants: [] });
    getBucketCorsMock.mockResolvedValue({ rules: [] });
    getBucketTagsMock.mockResolvedValue({ tags: [] });
    getBucketPublicAccessBlockMock.mockResolvedValue({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: false,
      restrict_public_buckets: false,
    });
    putBucketLifecycleMock.mockImplementation((_accountId, _bucketName, rules) => Promise.resolve({ rules }));
    getBucketReplicationMock.mockResolvedValue({ configuration: {} });
    listManagerObjectsMock.mockResolvedValue({ prefix: "", objects: [], prefixes: [], is_truncated: false });
    listCephAdminBucketObjectsMock.mockResolvedValue({ prefix: "", objects: [], prefixes: [], is_truncated: false });
    listCephAdminBucketsMock.mockResolvedValue({
      items: [{ name: "demo-bucket" }],
    });
    getCephAdminBucketPropertiesMock.mockResolvedValue({
      versioning_status: "Disabled",
      object_lock_enabled: false,
      object_lock: { enabled: false, mode: null, days: null, years: null },
      public_access_block: {
        block_public_acls: false,
        ignore_public_acls: false,
        block_public_policy: false,
        restrict_public_buckets: false,
      },
      lifecycle_rules: [],
      cors_rules: [],
    });
    getCephAdminBucketVersioningMock.mockResolvedValue({ status: "Disabled", enabled: false });
    getCephAdminBucketObjectLockMock.mockResolvedValue({ enabled: false, mode: null, days: null, years: null });
    getCephAdminBucketLifecycleMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketEncryptionMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketNotificationsMock.mockResolvedValue({ configuration: {} });
    getCephAdminBucketLoggingMock.mockResolvedValue({ enabled: false });
    getCephAdminBucketWebsiteMock.mockResolvedValue(null);
    getCephAdminBucketPolicyMock.mockResolvedValue({ policy: null });
    getCephAdminBucketAclMock.mockResolvedValue({ owner: "owner", grants: [] });
    getCephAdminBucketCorsMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketTagsMock.mockResolvedValue({ tags: [] });
    getCephAdminBucketPublicAccessBlockMock.mockResolvedValue({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: false,
      restrict_public_buckets: false,
    });
    putCephAdminBucketLifecycleMock.mockImplementation((_endpointId, _bucketName, rules) => Promise.resolve({ rules }));
    getCephAdminBucketReplicationMock.mockResolvedValue({
      configuration: { Role: "" },
    });
    setCephAdminBucketVersioningMock.mockResolvedValue(undefined);
    updateCephAdminBucketObjectLockMock.mockResolvedValue({
      enabled: true,
      mode: null,
      days: null,
      years: null,
    });
    fetchCephAdminClusterTrafficMock.mockResolvedValue({
      window: "week",
      start: null,
      end: null,
      series: [],
      totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_rate: null },
      bucket_rankings: [],
      user_rankings: [],
      request_breakdown: [],
      category_breakdown: [],
    });
    deleteCephAdminBucketReplicationMock.mockResolvedValue(undefined);
    putBucketCorsMock.mockImplementation((_account, _bucket, rules) => Promise.resolve({ rules }));
    putCephAdminBucketCorsMock.mockImplementation((_endpoint, _bucket, rules) => Promise.resolve({ rules }));
  });

  function renderNavigableBucket(mode: "manager" | "ceph-admin" = "manager") {
    setSessionUserCache({ role: "ui_admin", authType: "password" });
    useS3AccountContextMock.mockReturnValue(managerCephAccountContext("acc-1"));
    const route = `/${mode}/buckets/demo-bucket?${mode === "manager" ? "ctx=acc-1" : "ep=1"}`;
    const router = createMemoryRouter([
      { path: `/${mode}/buckets/:bucketName`, element: <BucketDetailPage mode={mode} /> },
      { path: `/${mode}/buckets`, element: <p>Bucket inventory</p> },
      { path: "/other", element: <p>Other page</p> },
    ], { initialEntries: ["/other", route] });
    render(<RouterProvider router={router} />);
    return router;
  }

  function warnsBeforeUnload() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it.each(["manager", "ceph-admin"] as const)("guards route, history, context and reload exits from a dirty %s CORS modal", async (mode) => {
    const user = userEvent.setup();
    const router = renderNavigableBucket(mode);
    try {
      await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
      const section = screen.getByTestId("bucket-feature-cors");
      await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
      expect(warnsBeforeUnload()).toBe(false);
      await user.click(within(section).getByRole("button", { name: "Configure" }));
      const dialog = screen.getByRole("dialog", { name: "Edit CORS rules" });
      await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
      const editor = within(dialog).getByLabelText("CORS rules (JSON)");
      const draft = '[{"AllowedOrigins":["https://example.org"],"AllowedMethods":["GET"]}]';
      fireEvent.change(editor, { target: { value: draft } });
      expect(putBucketCorsMock).not.toHaveBeenCalled();
      expect(putCephAdminBucketCorsMock).not.toHaveBeenCalled();
      await waitFor(() => expect(warnsBeforeUnload()).toBe(true));

      for (const leave of [
        () => router.navigate(-1),
        () => router.navigate(`?${mode === "manager" ? "ctx=acc-2" : "ep=2"}`),
        () => router.navigate("/other"),
      ]) {
        await act(async () => { void leave(); });
        expect(screen.getAllByRole("dialog", { name: "Discard changes?" })).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "Keep editing" }));
        expect(router.state.location.pathname).toBe(`/${mode}/buckets/demo-bucket`);
        expect(screen.getByRole("dialog", { name: "Edit CORS rules" })).toBeVisible();
        expect(editor).toHaveValue(draft);
      }

      await act(async () => { void router.navigate(`/${mode}/buckets`); });
      await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
      expect(await screen.findByText("Bucket inventory")).toBeVisible();
      expect(warnsBeforeUnload()).toBe(false);
    } finally { router.dispose(); }
  });

  it("preserves unrelated page drafts and protects an open CORS modal from Refresh", async () => {
    const user = userEvent.setup();
    const router = renderNavigableBucket();
    try {
      await user.click(screen.getByRole("tab", { name: "Properties", exact: true }));
      const objectLock = screen.getByTestId("bucket-feature-object-lock");
      await waitFor(() => expect(objectLock).toHaveAttribute("aria-busy", "false"));
      await user.click(within(objectLock).getByRole("switch", { name: "Enable object lock" }));

      await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
      const cors = screen.getByTestId("bucket-feature-cors");
      await waitFor(() => expect(cors).toHaveAttribute("aria-busy", "false"));
      await user.click(within(cors).getByRole("button", { name: "Configure" }));
      const dialog = screen.getByRole("dialog", { name: "Edit CORS rules" });
      await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
      const editor = within(dialog).getByLabelText("CORS rules (JSON)");
      const draft = '[{"AllowedMethods":["GET"],"AllowedOrigins":["https://example.org"]}]';
      fireEvent.change(editor, { target: { value: draft } });
      const corsReads = getBucketCorsMock.mock.calls.length;
      const policyReads = getBucketPolicyMock.mock.calls.length;

      await user.click(screen.getByRole("button", { name: "Refresh", exact: true }));
      expect(getBucketCorsMock).toHaveBeenCalledTimes(corsReads);
      expect(getBucketPolicyMock.mock.calls.length).toBeGreaterThan(policyReads);
      expect(editor).toHaveValue(draft);
      expect(putBucketCorsMock).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit CORS rules" })).not.toBeInTheDocument());
      expect(putBucketCorsMock).toHaveBeenCalledWith("acc-1", "demo-bucket", JSON.parse(draft));

      await user.click(screen.getByRole("tab", { name: "Properties", exact: true }));
      const retainedLock = screen.getByTestId("bucket-feature-object-lock");
      expect(within(retainedLock).getByRole("switch", { name: "Enable object lock" })).toBeChecked();
      expect(warnsBeforeUnload()).toBe(true);
      await user.click(within(retainedLock).getByRole("button", { name: "Reset", exact: true }));
      // Enabling Object Lock also changes the independent Versioning draft.
      expect(warnsBeforeUnload()).toBe(true);
      await user.click(within(screen.getByTestId("bucket-feature-versioning")).getByRole("switch", { name: "Enable versioning" }));
      await waitFor(() => expect(warnsBeforeUnload()).toBe(false));
      await act(async () => { await router.navigate("/other"); });
      expect(screen.getByText("Other page")).toBeVisible();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally { router.dispose(); }
  });

  it("keeps a failed CORS modal save guarded and releases navigation after a successful retry", async () => {
    const user = userEvent.setup();
    const router = renderNavigableBucket("ceph-admin");
    putCephAdminBucketCorsMock.mockRejectedValueOnce(new Error("Temporary failure"));
    try {
      await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
      const section = screen.getByTestId("bucket-feature-cors");
      await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
      await user.click(within(section).getByRole("button", { name: "Configure" }));
      const dialog = screen.getByRole("dialog", { name: "Edit CORS rules" });
      await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
      fireEvent.change(within(dialog).getByLabelText("CORS rules (JSON)"), {
        target: { value: '[{"AllowedMethods":["GET"],"AllowedOrigins":["*"]}]' },
      });
      await user.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
      await waitFor(() => expect(putCephAdminBucketCorsMock).toHaveBeenCalledOnce());
      expect(screen.getByRole("dialog", { name: "Edit CORS rules" })).toBeVisible();

      await act(async () => { void router.navigate("/other"); });
      expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      await user.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit CORS rules" })).not.toBeInTheDocument());
      await waitFor(() => expect(warnsBeforeUnload()).toBe(false));
      await act(async () => { await router.navigate("/other"); });
      expect(screen.getByText("Other page")).toBeVisible();
    } finally { router.dispose(); }
  });

  it("blocks discarding a CORS modal during a pending write and prevents refresh from overwriting it", async () => {
    const user = userEvent.setup();
    let finishSave!: (value: { rules: Record<string, unknown>[] }) => void;
    putBucketCorsMock.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
    const router = renderNavigableBucket();
    try {
      await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
      const section = screen.getByTestId("bucket-feature-cors");
      await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
      await user.click(within(section).getByRole("button", { name: "Configure" }));
      const dialog = screen.getByRole("dialog", { name: "Edit CORS rules" });
      await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
      fireEvent.change(within(dialog).getByLabelText("CORS rules (JSON)"), {
        target: { value: '[{"AllowedMethods":["GET"],"AllowedOrigins":["*"]}]' },
      });
      const reads = getBucketCorsMock.mock.calls.length;
      await user.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
      await user.click(screen.getByRole("button", { name: "Refresh", exact: true }));
      expect(getBucketCorsMock).toHaveBeenCalledTimes(reads);
      await act(async () => { void router.navigate("/other"); });
      expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
      expect(warnsBeforeUnload()).toBe(true);
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      await act(async () => finishSave({ rules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["*"] }] }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit CORS rules" })).not.toBeInTheDocument());
      await waitFor(() => expect(warnsBeforeUnload()).toBe(false));
      await act(async () => { await router.navigate("/other"); });
      expect(screen.getByText("Other page")).toBeVisible();
    } finally { router.dispose(); }
  });

  it("renders CORS as a read-only summary and preserves advanced rules in the Visual/JSON modal", async () => {
    const user = userEvent.setup();
    const advancedRule = {
      ID: "advanced-cors",
      AllowedOrigins: ["https://advanced.example"],
      AllowedMethods: ["GET"],
      CustomExtension: { keep: true },
    };
    getCephAdminBucketCorsMock.mockResolvedValue({
      rules: [
        {
          ID: "browser",
          AllowedOrigins: ["https://app.example.com"],
          AllowedMethods: ["GET", "PUT"],
          AllowedHeaders: ["Content-Type"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
        advancedRule,
      ],
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
    const section = await screen.findByTestId("bucket-feature-cors");
    await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
    expect(within(section).getByText("2 rules")).toBeInTheDocument();
    expect(within(section).getByRole("table")).toHaveClass("responsive-data-table");
    expect(within(section).getByText("https://app.example.com")).toBeInTheDocument();
    expect(within(section).getByText("GET, PUT")).toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit CORS rules" });
    expect(within(dialog).getByRole("tab", { name: "Visual" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getAllByTestId("cors-visual-rule")).toHaveLength(1);
    const advanced = within(dialog).getByTestId("cors-advanced-rule");
    expect(within(advanced).getByText("Advanced rule — edit in JSON")).toBeInTheDocument();
    expect(within(advanced).queryByRole("button", { name: "Remove rule" })).not.toBeInTheDocument();

    const visualRule = within(dialog).getByTestId("cors-visual-rule");
    const origin = within(visualRule).getByLabelText("Origin 1");
    await user.clear(origin);
    await user.type(origin, "https://new.example.com");
    expect(putCephAdminBucketCorsMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
    const json = within(dialog).getByLabelText("CORS rules (JSON)") as HTMLTextAreaElement;
    const parsed = JSON.parse(json.value);
    expect(parsed[0].AllowedOrigins).toEqual(["https://new.example.com"]);
    expect(parsed[1]).toEqual(advancedRule);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
  });

  it("keeps an empty CORS summary editable", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
    const section = await screen.findByTestId("bucket-feature-cors");
    await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
    expect(within(section).queryByText("Not configured")).not.toBeInTheDocument();
    expect(within(section).queryByText("0 rules")).not.toBeInTheDocument();
    expect(within(section).queryByText("No CORS rules configured on this bucket.")).not.toBeInTheDocument();
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Configure" })).toBeEnabled();
  });

  it.each(["manager", "ceph-admin"] as const)("disables every unchanged configuration save in %s", async (mode) => {
    const user = userEvent.setup();
    setSessionUserCache({ role: "ui_admin" });
    useS3AccountContextMock.mockReturnValue(managerCephAccountContext("acc-1"));
    render(
      <MemoryRouter>
        <BucketDetailPage mode={mode} bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>,
    );

    const tabs = [
      { name: "Properties" },
      { name: "Permissions" },
      { name: "Advanced" },
      { name: mode === "manager" ? "Privileged Ceph" : "Ceph Admin" },
    ];
    for (const tab of tabs) {
      await user.click(screen.getByRole("tab", { name: tab.name, exact: true }));
      const panel = screen.getByRole("tabpanel", { name: tab.name, exact: true });
      await waitFor(() => expect(panel.querySelector('[aria-busy="true"]')).toBeNull());
      const buttons = within(panel).getAllByRole("button", { name: "Save", exact: true });
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) expect(button).toBeDisabled();
    }
  });

  it("enables only the changed section and treats equivalent JSON as unchanged", async () => {
    const user = userEvent.setup();
    const policy = { Version: "2012-10-17", Statement: [] };
    getCephAdminBucketPolicyMock.mockResolvedValue({ policy });
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "Permissions", exact: true }));
    const policySection = screen.getByTestId("bucket-feature-policy");
    await user.click(within(policySection).getByRole("button", { name: "Configure" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit bucket policy" });
    await user.click(within(dialog).getByRole("tab", { name: "JSON", exact: true }));
    const editor = within(dialog).getByRole("textbox");
    const save = within(dialog).getByRole("button", { name: "Save", exact: true });
    await waitFor(() => expect(editor).toHaveValue(JSON.stringify(policy, null, 2)));

    fireEvent.change(editor, { target: { value: '{ "Statement": [], "Version": "2012-10-17" }' } });
    expect(save).toBeDisabled();
    fireEvent.change(editor, { target: { value: '{ "Statement": [{"Effect":"Allow"}], "Version": "2012-10-17" }' } });
    expect(save).toBeEnabled();
    const publicAccess = screen.getByTestId("bucket-feature-block-public-access");
    expect(within(publicAccess).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: JSON.stringify(policy) } });
    expect(save).toBeDisabled();

    const toggle = within(publicAccess).getAllByRole("switch")[0];
    await user.click(toggle);
    expect(within(publicAccess).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(toggle);
    expect(within(publicAccess).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps literal tag edits saveable and ignores an empty new row", async () => {
    const user = userEvent.setup();
    getCephAdminBucketTagsMock.mockResolvedValue({ tags: [{ key: "environment", value: "test" }] });
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "Properties", exact: true }));
    const section = screen.getByTestId("bucket-feature-tags");
    const value = await within(section).findByDisplayValue("test");
    const save = within(section).getByRole("button", { name: "Save", exact: true });
    await user.click(within(section).getByRole("button", { name: "Add tag" }));
    expect(save).toBeDisabled();
    fireEvent.change(value, { target: { value: "test " } });
    expect(save).toBeEnabled();
    fireEvent.change(value, { target: { value: "test" } });
    expect(save).toBeDisabled();
  });

  it("retains an Object Lock draft after failure and becomes clean after retry", async () => {
    const user = userEvent.setup();
    updateCephAdminBucketObjectLockMock.mockRejectedValueOnce(new Error("Temporary failure"));
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("tab", { name: "Properties", exact: true }));
    const section = screen.getByTestId("bucket-feature-object-lock");
    const save = within(section).getByRole("button", { name: "Save", exact: true });
    const reset = within(section).getByRole("button", { name: "Reset", exact: true });
    const toggle = within(section).getByRole("switch", { name: "Enable object lock" });
    await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
    expect(reset).toBeDisabled();
    fireEvent.submit(section.querySelector("form")!);
    expect(updateCephAdminBucketObjectLockMock).not.toHaveBeenCalled();
    await user.click(toggle);
    expect(save).toBeEnabled();
    expect(reset).toBeEnabled();
    await user.click(save);
    expect(await within(section).findByText("Temporary failure")).toBeVisible();
    expect(toggle).toBeChecked();
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(within(section).getByRole("status")).toHaveTextContent("Configured"));
    expect(save).toBeDisabled();
    expect(reset).toBeDisabled();
    expect(updateCephAdminBucketObjectLockMock).toHaveBeenCalledTimes(2);
  });

  it("renders the Manager bucket detail header with a working buckets return action", () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerBucketQuotaEnabled: false,
    });

    render(
      <MemoryRouter initialEntries={["/manager/buckets/demo-bucket"]}>
        <BucketDetailPage bucketNameOverride="demo-bucket" />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Back to buckets/i })).toHaveAttribute("href", "/manager/buckets");
  });

  it("supports a history-aware Ceph Admin return action and endpoint-scoped breadcrumb", () => {
    const onBack = vi.fn();
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: null,
      selectedEndpoint: null,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage
          mode="ceph-admin"
          bucketNameOverride="demo-bucket"
          bucketListPathOverride="/ceph-admin/buckets?ep=7"
          onBackToBuckets={onBack}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Buckets" })).toHaveAttribute("href", "/ceph-admin/buckets?ep=7");
    fireEvent.click(screen.getByRole("button", { name: /Back to buckets/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders the bucket overview without a redundant eyebrow or nested card shell", async () => {
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const bucketTitle = await screen.findByRole("heading", { name: "Bucket demo-bucket" });
    const overviewSection = bucketTitle.closest("section");

    expect(overviewSection).not.toBeNull();
    expect(overviewSection).not.toHaveClass("ui-surface-card");
    expect(within(overviewSection as HTMLElement).queryByText("Overview")).not.toBeInTheDocument();
    expect(within(overviewSection as HTMLElement).queryByText("Summary of enabled features.")).not.toBeInTheDocument();

    const propertiesGroup = within(overviewSection as HTMLElement).getByText("Bucket properties").parentElement;
    expect(propertiesGroup).not.toHaveClass("ui-surface-muted");
  });

  it("shows a read-only object browser for Ceph Admin buckets", async () => {
    const user = userEvent.setup();
    listCephAdminBucketObjectsMock.mockResolvedValue({
      prefix: "",
      objects: [
        {
          key: "reports/summary.csv",
          size: 2048,
          last_modified: "2026-07-16T08:00:00Z",
          storage_class: "STANDARD",
        },
      ],
      prefixes: ["reports/"],
      is_truncated: false,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Objects / S3 Console" }));

    await waitFor(() =>
      expect(listCephAdminBucketObjectsMock).toHaveBeenCalledWith(1, "demo-bucket", "")
    );
    expect(screen.getAllByText("reports/")).not.toHaveLength(0);
    expect(screen.getByText("reports/summary.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "(root)" })).toHaveClass("ui-list-action", "ui-list-action-active");
    expect(screen.getByRole("button", { name: "(root)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "reports/" })).toHaveClass("ui-list-action");
    expect(
      screen.getAllByRole("button", { name: "Refresh", exact: true }).some((button) => button.classList.contains("ui-list-action")),
    ).toBe(true);
    expect(
      screen.getByText("Read-only preview using the selected endpoint's Ceph Admin credentials.")
    ).toBeInTheDocument();
  });

  it("loads the Manager overview contract once and isolates object-tab loading", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue(
      managerCephAccountContext("acc-ceph"),
    );

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getBucketNotificationsMock).toHaveBeenCalledOnce();
    });

    expect(getBucketStatsMock).toHaveBeenCalledOnce();
    expect(getBucketVersioningMock).toHaveBeenCalledOnce();
    expect(getBucketObjectLockMock).toHaveBeenCalledOnce();
    expect(getBucketLifecycleMock).toHaveBeenCalledOnce();
    expect(getBucketPolicyMock).toHaveBeenCalledOnce();
    expect(getBucketAclMock).toHaveBeenCalledOnce();
    expect(getBucketCorsMock).toHaveBeenCalledOnce();
    expect(getBucketReplicationMock).toHaveBeenCalledOnce();
    expect(getBucketEncryptionMock).toHaveBeenCalledOnce();
    expect(getBucketPublicAccessBlockMock).toHaveBeenCalledOnce();
    expect(getBucketWebsiteMock).toHaveBeenCalledOnce();
    expect(getBucketLoggingMock).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    await user.click(screen.getByRole("tab", { name: "Objects / S3 Console" }));

    await waitFor(() => {
      expect(listManagerObjectsMock).toHaveBeenCalledOnce();
    });
    expect(getBucketStatsMock).not.toHaveBeenCalled();
    expect(getBucketVersioningMock).not.toHaveBeenCalled();
    expect(getBucketLifecycleMock).not.toHaveBeenCalled();
    expect(getBucketNotificationsMock).not.toHaveBeenCalled();
  });

  it("keeps the active tab while isolating late responses from an old account", async () => {
    const user = userEvent.setup();
    let accountId = "acc-old";
    const accountContext = () => managerCephAccountContext(accountId);
    useS3AccountContextMock.mockImplementation(accountContext);

    let resolveOldLogging!: (value: {
      enabled: boolean;
      target_bucket: string;
      target_prefix: string;
    }) => void;
    const oldLogging = new Promise<{
      enabled: boolean;
      target_bucket: string;
      target_prefix: string;
    }>((resolve) => {
      resolveOldLogging = resolve;
    });
    getBucketLoggingMock.mockImplementation((requestedAccountId: string) =>
      requestedAccountId === "acc-old"
        ? oldLogging
        : Promise.resolve({
            enabled: true,
            target_bucket: "new-logs",
            target_prefix: "new/",
          })
    );

    const renderPage = () => (
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );
    const view = render(renderPage());

    await waitFor(() => {
      expect(getBucketLoggingMock).toHaveBeenCalledWith("acc-old", "demo-bucket");
    });
    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    accountId = "acc-new";
    view.rerender(renderPage());

    const accessLoggingCard = await screen.findByTestId("bucket-feature-access-logging");
    await waitFor(() => {
      expect(within(accessLoggingCard).getByLabelText("Target bucket")).toHaveValue("new-logs");
    });

    await act(async () => {
      resolveOldLogging({
        enabled: true,
        target_bucket: "old-logs",
        target_prefix: "old/",
      });
      await oldLogging;
    });

    expect(within(accessLoggingCard).getByLabelText("Target bucket")).toHaveValue("new-logs");
    expect(screen.getByRole("tab", { name: "Advanced" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses the shared warning banner when Ceph Admin bucket context is missing", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: null,
      selectedEndpoint: null,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const endpointWarning = await screen.findByText("Select a Ceph endpoint before managing this bucket.");
    expect(endpointWarning).toHaveClass("ui-caption");
    expect(endpointWarning).toHaveClass("border-amber-200");
  });

  it("hides Manager quota tab without bucket quota access", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: "ceph-account", name: "Ceph account", endpoint_provider: "ceph" }],
      selectedS3AccountId: "ceph-account",
      accountIdForApi: "ceph-account",
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerBucketQuotaEnabled: false,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded hideObjectsTab />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Bucket demo-bucket" });
    expect(screen.queryByRole("tab", { name: "Privileged Ceph" })).not.toBeInTheDocument();
  });

  it("shows Manager quota tab with bucket quota access", async () => {
    setSessionUserCache({
      role: "ui_user",
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        feature_rules: false,
      },
    });
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: "ceph-account", name: "Ceph account", endpoint_provider: "ceph" }],
      selectedS3AccountId: "ceph-account",
      accountIdForApi: "ceph-account",
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerBucketQuotaEnabled: true,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded hideObjectsTab />
      </MemoryRouter>
    );

    expect(await screen.findByRole("tab", { name: "Privileged Ceph" })).toBeInTheDocument();
  });

  it("hides Storage Ops quota tab when the context is not quota eligible", async () => {
    setSessionUserCache({
      role: "ui_user",
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        feature_rules: false,
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage
          bucketNameOverride="demo-bucket"
          accountIdOverride="conn-aws"
          hideQuotaTab
          embedded
          hideObjectsTab
        />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Bucket demo-bucket" });
    expect(screen.queryByRole("tab", { name: "Privileged Ceph" })).not.toBeInTheDocument();
  });

  it("treats replication payload with empty role and no rules as not configured", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketReplicationMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Replication")).toBeInTheDocument();
    expect((await screen.findAllByText("Not set")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    expect(replicationCard).toHaveAttribute("data-feature-state", "neutral");
    expect(within(replicationCard).queryByText("0 rules")).not.toBeInTheDocument();
    expect(within(replicationCard).queryByRole("table")).not.toBeInTheDocument();
    expect(within(replicationCard).getByRole("button", { name: "Configure" })).toBeEnabled();
    expect(within(replicationCard).queryByLabelText("Role ARN")).not.toBeInTheDocument();
    expect(
      screen.getByText("Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/cross-zonegroup/i)).not.toBeInTheDocument();
  });

  it("keeps the replication summary read-only and edits rules inside the modal", async () => {
    const user = userEvent.setup();
    getCephAdminBucketReplicationMock.mockResolvedValue({
      configuration: {
        Role: "arn:aws:iam::123456789012:role/replication",
        Rules: [
          {
            ID: "rule-1",
            Status: "Enabled",
            Destination: { Bucket: "arn:aws:s3:::target-bucket" },
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => expect(getCephAdminBucketReplicationMock).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    expect(within(replicationCard).getByText("rule-1")).toBeInTheDocument();
    expect(within(replicationCard).queryByRole("textbox", { name: "ID" })).not.toBeInTheDocument();

    await user.click(within(replicationCard).getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("dialog", { name: "Edit replication configuration" });
    const ruleIdInput = within(editor).getByRole("textbox", { name: "ID" });
    expect(ruleIdInput).toHaveValue("rule-1");
    await user.type(ruleIdInput, "-updated");

    expect(ruleIdInput).toHaveFocus();
    expect(within(editor).getByRole("textbox", { name: "ID" })).toBe(ruleIdInput);
    expect(ruleIdInput).toHaveValue("rule-1-updated");
    expect(putCephAdminBucketReplicationMock).not.toHaveBeenCalled();
  });

  it("uses contextual shared confirmations for destructive bucket configuration actions", async () => {
    const user = userEvent.setup();
    getCephAdminBucketEncryptionMock.mockResolvedValue({ rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] });
    getCephAdminBucketTagsMock.mockResolvedValue({ tags: [{ key: "environment", value: "test" }] });
    getCephAdminBucketPolicyMock.mockResolvedValue({ policy: { Version: "2012-10-17", Statement: [] } });
    getCephAdminBucketCorsMock.mockResolvedValue({ rules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["*"] }] });
    getCephAdminBucketWebsiteMock.mockResolvedValue({
      index_document: "index.html",
      error_document: null,
      redirect_all_requests_to: null,
      routing_rules: [],
    });
    getCephAdminBucketReplicationMock.mockResolvedValue({
      configuration: {
        Role: "arn:aws:iam::123456789012:role/replication",
        Rules: [{ ID: "rule-1", Status: "Enabled", Destination: { Bucket: "arn:aws:s3:::target" } }],
      },
    });
    getCephAdminBucketLoggingMock.mockResolvedValue({ enabled: true, target_bucket: "logs", target_prefix: "demo/" });
    getCephAdminBucketNotificationsMock.mockResolvedValue({
      configuration: { TopicConfigurations: [{ Id: "topic-1", TopicArn: "arn:aws:sns:::events", Events: ["s3:ObjectCreated:*"] }] },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const assertConfirmation = async (cardTestId: string, buttonName: string, headingName: string) => {
      const card = await screen.findByTestId(cardTestId);
      const button = within(card.parentElement?.parentElement as HTMLElement).getByRole("button", { name: buttonName });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);
      expect(screen.getByRole("heading", { name: headingName })).toBeInTheDocument();
      expect(screen.getByText("demo-bucket")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    };

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    await assertConfirmation("bucket-feature-tags", "Clear", "Clear all bucket tags?");

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    const policyCard = await screen.findByTestId("bucket-feature-policy");
    expect(within(policyCard).getByRole("button", { name: "Configure" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    await assertConfirmation("bucket-feature-website", "Delete", "Delete static website configuration?");
    await assertConfirmation("bucket-feature-access-logging", "Disable", "Disable server access logging?");

    const notificationsCard = await screen.findByTestId("bucket-feature-notifications");
    const editNotificationsButton = within(notificationsCard.parentElement?.parentElement as HTMLElement)
      .getByRole("button", { name: "Edit" });
    expect(editNotificationsButton).toBeEnabled();

    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    expect(within(replicationCard).getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(within(replicationCard).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  }, 15_000);

  it("preserves bucket tag row identity when removing another draft", async () => {
    const user = userEvent.setup();
    getCephAdminBucketTagsMock.mockResolvedValueOnce({
      tags: [
        { key: "environment", value: "test" },
        { key: "owner", value: "platform" },
      ],
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    const tagsCard = await screen.findByTestId("bucket-feature-tags");
    const tagKeyInputs = within(tagsCard).getAllByPlaceholderText("Tag key");
    const ownerInput = tagKeyInputs[1];
    const firstTagRow = tagKeyInputs[0].closest("[data-tag-row]");
    expect(firstTagRow).not.toBeNull();

    await user.click(within(firstTagRow!).getByRole("button", { name: "Remove" }));

    expect(within(tagsCard).getAllByPlaceholderText("Tag key")[0]).toBe(ownerInput);
    expect(ownerInput).toHaveValue("owner");
  });

  it("disables replication when the endpoint capability is disabled", async () => {
    const user = userEvent.setup();
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
          replication: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    expect(screen.queryByText("Replication")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    expect(getCephAdminBucketReplicationMock).not.toHaveBeenCalled();
    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    expect(replicationCard).toHaveAttribute("data-feature-state", "disabled");
    expect(within(replicationCard).getByText("Bucket replication is disabled on this endpoint.")).toBeInTheDocument();
    expect(within(replicationCard).getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(within(replicationCard).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(within(replicationCard).queryByLabelText("Role ARN")).not.toBeInTheDocument();
  });

  it("shows the Notifications overview badge when SNS is enabled", async () => {
    getCephAdminBucketNotificationsMock.mockResolvedValueOnce({
      configuration: {
        TopicConfigurations: [
          {
            Id: "topic-1",
            TopicArn: "arn:aws:sns:us-east-1:123456789012:bucket-events",
            Events: ["s3:ObjectCreated:*"],
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketNotificationsMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getAllByText("Configured").length).toBeGreaterThan(0);
  });

  it("hides the Notifications overview badge when SNS is disabled", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
          replication: true,
          sns: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listCephAdminBucketsMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });

  it("keeps notifications card neutral for TopicConfigurations empty draft-equivalent payload", async () => {
    const user = userEvent.setup();
    getCephAdminBucketNotificationsMock.mockResolvedValueOnce({
      configuration: { TopicConfigurations: [] },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketNotificationsMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    const notificationsCard = await screen.findByTestId("bucket-feature-notifications");
    expect(notificationsCard).toHaveAttribute("data-feature-state", "neutral");
  });

  it("automatically enables versioning before saving object lock", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    const objectLockCard = await screen.findByTestId("bucket-feature-object-lock");
    const objectLockSwitch = within(objectLockCard).getByLabelText("Enable object lock");
    await user.click(objectLockSwitch);

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const objectLockSaveButton = saveButtons.find((button) => button.getAttribute("form") === "bucket-object-lock-form");
    expect(objectLockSaveButton).toBeDefined();
    await user.click(objectLockSaveButton!);

    await waitFor(() => {
      expect(setCephAdminBucketVersioningMock).toHaveBeenCalledWith(1, "demo-bucket", true);
      expect(updateCephAdminBucketObjectLockMock).toHaveBeenCalled();
    });

    const versioningCallOrder = setCephAdminBucketVersioningMock.mock.invocationCallOrder[0];
    const objectLockCallOrder = updateCephAdminBucketObjectLockMock.mock.invocationCallOrder[0];
    expect(versioningCallOrder).toBeLessThan(objectLockCallOrder);
  });

  it("does not render replication info card in Ceph Admin tab", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketReplicationMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Ceph Admin" }));
    expect(screen.queryByText("Replication / multisite")).not.toBeInTheDocument();
  });

  it("keeps Properties cards visible when public access block is unavailable", async () => {
    const user = userEvent.setup();
    getCephAdminBucketPublicAccessBlockMock.mockRejectedValueOnce(new Error("XNotImplemented"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketPublicAccessBlockMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(await screen.findByTestId("bucket-feature-versioning")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-object-lock")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-lifecycle")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-tags")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-encryption")).toBeInTheDocument();
  });

  it("keeps non-versioning Properties cards visible when versioning is unavailable", async () => {
    const user = userEvent.setup();
    getCephAdminBucketVersioningMock.mockRejectedValue(new Error("versioning unavailable"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(await screen.findByText("versioning unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-object-lock")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-lifecycle")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-tags")).toBeInTheDocument();
  });

  it("keeps non-object-lock Properties cards visible when Object Lock is unavailable", async () => {
    const user = userEvent.setup();
    getCephAdminBucketObjectLockMock.mockRejectedValue(new Error("object lock unavailable"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(await screen.findByText("object lock unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-versioning")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-lifecycle")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-tags")).toBeInTheDocument();
  });

  it("renders Lifecycle as a read-only workbench summary with a dedicated Edit action", async () => {
    const user = userEvent.setup();
    getCephAdminBucketLifecycleMock.mockResolvedValue({
      rules: [
        {
          ID: "expire-old-versions",
          Status: "Enabled",
          Filter: { Prefix: "archive/" },
          NoncurrentVersionExpiration: { NoncurrentDays: 90 },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 30 },
        },
      ],
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    const lifecycle = await screen.findByTestId("bucket-feature-lifecycle");
    expect(lifecycle).toHaveAttribute("data-feature-presentation", "workbench");
    expect(within(lifecycle).getByText("1 rule")).toBeInTheDocument();
    const table = within(lifecycle).getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByRole("columnheader", { name: "Rule actions" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Manage" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Enabled" })).not.toBeInTheDocument();
    expect(within(table).getByText("Enabled")).toBeInTheDocument();
    expect(within(lifecycle).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("edits Lifecycle transactionally in the Visual/JSON dialog and saves only on Save", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketLifecycleMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    const lifecycle = await screen.findByTestId("bucket-feature-lifecycle");
    expect(within(lifecycle).queryByText("0 rules")).not.toBeInTheDocument();
    expect(within(lifecycle).queryByRole("table")).not.toBeInTheDocument();
    await user.click(within(lifecycle).getByRole("button", { name: "Configure" }));

    const dialog = screen.getByRole("dialog", { name: "Edit lifecycle rules" });
    expect(within(dialog).getByRole("tab", { name: "Visual" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    expect(putCephAdminBucketLifecycleMock).not.toHaveBeenCalled();

    const visualRule = within(dialog).getByTestId("lifecycle-visual-rule");
    await user.click(within(visualRule).getByText("Expiration and cleanup"));
    await user.type(within(visualRule).getByLabelText("Expire noncurrent versions after (days)"), "90");
    expect(putCephAdminBucketLifecycleMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
    const jsonEditor = within(dialog).getByLabelText("Lifecycle rules (JSON)") as HTMLTextAreaElement;
    expect(JSON.parse(jsonEditor.value)[0]).toMatchObject({
      Status: "Enabled",
      NoncurrentVersionExpiration: { NoncurrentDays: 90 },
    });

    await user.click(within(dialog).getByRole("tab", { name: "Visual" }));
    expect(within(dialog).getByLabelText("Expire noncurrent versions after (days)")).toHaveValue(90);
    expect(putCephAdminBucketLifecycleMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(putCephAdminBucketLifecycleMock).toHaveBeenCalled();
    });

    const savedRules = putCephAdminBucketLifecycleMock.mock.calls[0][2] as Record<string, unknown>[];
    expect(savedRules).toHaveLength(1);
    expect(savedRules[0]).toMatchObject({
      Status: "Enabled",
      NoncurrentVersionExpiration: { NoncurrentDays: 90 },
    });
    expect(savedRules[0]).not.toHaveProperty("Expiration");
    expect(screen.queryByRole("dialog", { name: "Edit lifecycle rules" })).not.toBeInTheDocument();
    expect(within(lifecycle).getByText("1 rule")).toBeInTheDocument();
  });

  it("keeps advanced Lifecycle rules read-only in Visual mode and fully available in JSON", async () => {
    const user = userEvent.setup();
    const advancedRule = {
      ID: "advanced-rule",
      Status: "Enabled",
      Filter: { And: { Prefix: "archive/", Tags: [{ Key: "tier", Value: "cold" }] } },
      Expiration: { Date: "2030-01-01T00:00:00Z" },
      CustomCephField: { keep: true },
    };
    getCephAdminBucketLifecycleMock.mockResolvedValue({ rules: [advancedRule] });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    const lifecycle = await screen.findByTestId("bucket-feature-lifecycle");
    await user.click(within(lifecycle).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog", { name: "Edit lifecycle rules" });
    const advanced = within(dialog).getByTestId("lifecycle-advanced-rule");
    expect(within(advanced).getByText("Advanced rule — edit in JSON")).toBeInTheDocument();
    expect(within(advanced).getByRole("button", { name: "Remove rule" })).toBeEnabled();

    await user.click(within(dialog).getByRole("tab", { name: "JSON" }));
    const jsonEditor = within(dialog).getByLabelText("Lifecycle rules (JSON)") as HTMLTextAreaElement;
    expect(JSON.parse(jsonEditor.value)).toEqual([advancedRule]);
  });

  it("guards dirty Lifecycle dismissal with Escape and restores focus to Edit after discard", async () => {
    const user = userEvent.setup();
    getCephAdminBucketLifecycleMock.mockResolvedValue({
      rules: [
        {
          ID: "focus-rule",
          Status: "Enabled",
          Filter: { Prefix: "logs/" },
          Expiration: { Days: 30 },
        },
      ],
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    const lifecycle = await screen.findByTestId("bucket-feature-lifecycle");
    const editButton = within(lifecycle).getByRole("button", { name: "Edit" });
    await user.click(editButton);

    const dialog = screen.getByRole("dialog", { name: "Edit lifecycle rules" });
    const idInput = within(dialog).getByLabelText("ID");
    await waitFor(() => expect(idInput).toHaveFocus());
    await user.clear(idInput);
    await user.type(idInput, "changed-rule");

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Edit lifecycle rules" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(within(dialog).getByLabelText("ID")).toHaveValue("changed-rule");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    expect(screen.queryByRole("dialog", { name: "Edit lifecycle rules" })).not.toBeInTheDocument();
    await waitFor(() => expect(editButton).toHaveFocus());
    expect(putCephAdminBucketLifecycleMock).not.toHaveBeenCalled();
  });

  it("disables server access logging when the endpoint does not implement it", async () => {
    const user = userEvent.setup();
    getCephAdminBucketLoggingMock.mockRejectedValue(
      new Error(
        "Unable to fetch bucket logging for 'demo-bucket': An error occurred (XNotImplemented) when calling the GetBucketLogging operation: The request you provided implies functionality that is not implemented."
      )
    );

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketLoggingMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    const accessLoggingCard = await screen.findByTestId("bucket-feature-access-logging");
    const accessLoggingShell = accessLoggingCard.parentElement?.parentElement as HTMLElement;
    expect(accessLoggingCard).toHaveAttribute("data-feature-state", "disabled");
    expect(within(accessLoggingShell).getByRole("button", { name: "Disable" })).toBeDisabled();
    expect(within(accessLoggingShell).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(accessLoggingCard).getByLabelText("Enable server access logging")).toBeDisabled();
    expect(within(accessLoggingCard).getByLabelText("Target bucket")).toBeDisabled();
    expect(within(accessLoggingCard).getByLabelText("Target prefix (optional)")).toBeDisabled();
  });

  it("disables JSON feature cards when the endpoint returns XNotImplemented", async () => {
    const user = userEvent.setup();
    getCephAdminBucketNotificationsMock.mockRejectedValue(
      new Error("An error occurred (XNotImplemented) when calling the GetBucketNotificationConfiguration operation.")
    );

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketNotificationsMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    const notificationsCard = await screen.findByTestId("bucket-feature-notifications");
    const notificationsShell = notificationsCard.parentElement?.parentElement as HTMLElement;
    expect(notificationsCard).toHaveAttribute("data-feature-state", "disabled");
    expect(within(notificationsShell).getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(within(notificationsCard).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not disable feature cards for non-implementation-unrelated errors", async () => {
    const user = userEvent.setup();
    getCephAdminBucketLoggingMock.mockRejectedValue(new Error("AccessDenied"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketLoggingMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    const accessLoggingCard = await screen.findByTestId("bucket-feature-access-logging");
    const accessLoggingShell = accessLoggingCard.parentElement?.parentElement as HTMLElement;
    const accessDeniedMessage = within(accessLoggingCard).getByText("AccessDenied");
    expect(accessDeniedMessage).toBeInTheDocument();
    expect(accessDeniedMessage).toHaveClass("ui-caption");
    expect(accessLoggingCard).toHaveAttribute("data-feature-state", "neutral");
    expect(within(accessLoggingShell).getByRole("button", { name: "Save" })).toBeDisabled();
    const toggle = within(accessLoggingCard).getByLabelText("Enable server access logging");
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(within(accessLoggingShell).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps bucket Metrics available for non-Ceph manager endpoints", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          kind: "connection",
          id: "conn-aws",
          display_name: "AWS connection",
          tags: [],
          endpoint_tags: [],
          endpoint_provider: "aws",
          storage_endpoint_capabilities: { metrics: true, usage: true },
          capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
        },
      ],
      selectedS3AccountId: "conn-aws",
      accountIdForApi: "conn-aws",
      requiresS3AccountSelection: true,
      accessMode: "connection",
      managerBucketQuotaEnabled: false,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded hideObjectsTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getBucketStatsMock).toHaveBeenCalled();
    });

    const metricsTab = screen.getByRole("tab", { name: "Metrics" });
    expect(metricsTab).not.toBeDisabled();

    await user.click(metricsTab);

    expect(screen.getByText("Current usage and quota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Traffic" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Live endpoint metrics are unavailable. BucketReef usage stats calculated from bucket listings remain available in the Usage stats tab."
      )
    ).toBeInTheDocument();
  });

  it("keeps bucket Metrics clickable for Ceph endpoints with metrics enabled", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const metricsTab = screen.getByRole("tab", { name: "Metrics" });
    expect(metricsTab).not.toBeDisabled();

    await user.click(metricsTab);

    expect(await screen.findByText("Current usage and quota")).toBeInTheDocument();
    const trafficTitle = screen.getByRole("heading", { name: "Traffic" });
    expect(trafficTitle).toHaveClass("ui-section");
    expect(screen.queryByText("Bucket: demo-bucket")).not.toBeInTheDocument();
  });

  it("keeps bucket Metrics available for Ceph endpoints when metrics capability is disabled", async () => {
    const user = userEvent.setup();
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listCephAdminBucketsMock).toHaveBeenCalled();
    });

    const metricsTab = screen.getByRole("tab", { name: "Metrics" });
    expect(metricsTab).not.toBeDisabled();

    await user.click(metricsTab);

    expect(screen.getByText("Current usage and quota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Traffic" })).not.toBeInTheDocument();
    expect(screen.getByText(/BucketReef usage stats calculated from bucket listings/)).toBeInTheDocument();
  });
});
