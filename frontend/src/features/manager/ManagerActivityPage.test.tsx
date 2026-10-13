import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerActivityPage from "./ManagerActivityPage";

const listManagerActivityMock = vi.fn();
const useS3AccountContextMock = vi.fn();

vi.mock("../../api/managerActivity", () => ({
  listManagerActivity: (...args: unknown[]) => listManagerActivityMock(...args),
}));

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

function accountContext(overrides?: Record<string, unknown>) {
  return {
    accountIdForApi: "account-1",
    hasS3AccountContext: true,
    selectedS3AccountType: "tenant",
    managerFeatureStates: {
      activity_history: { enabled: true, source: "platform" },
    },
    ...overrides,
  };
}

function activity(id: number, overrides?: Record<string, unknown>) {
  return {
    id,
    created_at: "2026-10-13T10:00:00Z",
    action: "create_bucket",
    entity_type: "bucket",
    entity_id: `bucket-${id}`,
    account_id: 1,
    account_name: "Research",
    status: "success",
    user_email: "manager@example.test",
    ...overrides,
  };
}

describe("ManagerActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useS3AccountContextMock.mockReturnValue(accountContext());
    listManagerActivityMock.mockResolvedValue([]);
  });

  it("renders context-scoped activity with readable and technical actions", async () => {
    listManagerActivityMock.mockResolvedValue([activity(42)]);

    render(<MemoryRouter><ManagerActivityPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Activity history" })).toBeInTheDocument();
    expect(await screen.findByText("Bucket created")).toBeInTheDocument();
    expect(screen.getByText("create_bucket")).toBeInTheDocument();
    expect(screen.getByText("manager@example.test")).toBeInTheDocument();
    expect(screen.getByText("bucket-42")).toBeInTheDocument();
    expect(screen.getByText(/S3 object access logs are not included/)).toBeInTheDocument();
  });

  it("sends actor/action/target search and status filters to the API", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ManagerActivityPage /></MemoryRouter>);
    await waitFor(() => expect(listManagerActivityMock).toHaveBeenCalledWith("account-1", {
      limit: 20,
      search: "",
      status: undefined,
    }));

    await user.type(screen.getByPlaceholderText("Search actor, action, or target"), "policy");
    await user.selectOptions(screen.getByLabelText("Status"), "failure");

    await waitFor(() => expect(listManagerActivityMock).toHaveBeenLastCalledWith("account-1", {
      limit: 20,
      search: "policy",
      status: "failure",
    }));
  });

  it("loads older activity using the last audit id as cursor", async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 20 }, (_, index) => activity(100 - index));
    listManagerActivityMock
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([activity(80)]);

    render(<MemoryRouter><ManagerActivityPage /></MemoryRouter>);

    const loadOlder = await screen.findByRole("button", { name: "Load older" });
    await user.click(loadOlder);

    await waitFor(() => expect(listManagerActivityMock).toHaveBeenLastCalledWith("account-1", {
      limit: 20,
      cursor: 81,
      search: "",
      status: undefined,
    }));
    expect(await screen.findByText("bucket-80")).toBeInTheDocument();
  });

  it("loads activity for an enabled RGW User context", async () => {
    useS3AccountContextMock.mockReturnValue(accountContext({
      accountIdForApi: "s3u-8",
      selectedS3AccountType: "s3_user",
    }));
    listManagerActivityMock.mockResolvedValue([activity(8, {
      context_kind: "s3_user",
      context_id: "s3u-8",
      context_name: "Standalone user",
      account_id: null,
      account_name: null,
    })]);
    render(<MemoryRouter><ManagerActivityPage /></MemoryRouter>);

    expect(await screen.findByText("Bucket created")).toBeInTheDocument();
    await waitFor(() => expect(listManagerActivityMock).toHaveBeenCalledWith("s3u-8", {
      limit: 20,
      search: "",
      status: undefined,
    }));
  });

  it("redirects disabled contexts to the Manager dashboard", async () => {
    useS3AccountContextMock.mockReturnValue(accountContext({
      selectedS3AccountType: "s3_user",
      managerFeatureStates: { activity_history: { enabled: false, source: "resource" } },
    }));
    render(
      <MemoryRouter initialEntries={["/manager/activity"]}>
        <Routes>
          <Route path="/manager" element={<div>Manager dashboard destination</div>} />
          <Route path="/manager/activity" element={<ManagerActivityPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("Manager dashboard destination")).toBeInTheDocument();
    expect(listManagerActivityMock).not.toHaveBeenCalled();
  });

  it("shows empty and error states without exposing additional audit fields", async () => {
    const { rerender } = render(<MemoryRouter><ManagerActivityPage /></MemoryRouter>);
    expect(await screen.findByText("No Manager activity has been recorded for this context yet.")).toBeInTheDocument();

    listManagerActivityMock.mockRejectedValue(new Error("audit backend unavailable"));
    rerender(<MemoryRouter><ManagerActivityPage /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/audit backend unavailable|Unable to load activity history/)).toBeInTheDocument();
  });
});
