import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerUserGroupsPage from "./ManagerUserGroupsPage";

const api = vi.hoisted(() => ({
  getUser: vi.fn(),
  listGroups: vi.fn(),
  addUser: vi.fn(),
  removeUser: vi.fn(),
}));

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => ({
    selectedContextKind: "account",
    contextIdForApi: "acc-1",
    requiresContextSelection: false,
    accessMode: "default",
  }),
}));

vi.mock("../../api/managerIamUsers", async (original) => ({
  ...await original<typeof import("../../api/managerIamUsers")>(),
  getIamUser: api.getUser,
}));

vi.mock("../../api/managerIamGroups", async (original) => ({
  ...await original<typeof import("../../api/managerIamGroups")>(),
  listIamGroupsPage: api.listGroups,
  addIamGroupUser: api.addUser,
  removeIamGroupUser: api.removeUser,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/users/alice/groups"]}>
      <Routes>
        <Route path="/manager/users/:userName/groups" element={<ManagerUserGroupsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ManagerUserGroupsPage", () => {
  const memberships = new Set(["operators"]);

  beforeEach(() => {
    vi.resetAllMocks();
    memberships.clear();
    memberships.add("operators");
    api.getUser.mockImplementation(async () => ({ name: "alice", groups: [...memberships] }));
    api.listGroups.mockResolvedValue({
      items: [
        { name: "operators", arn: "arn:aws:iam::acc-1:group/operators" },
        { name: "auditors", arn: "arn:aws:iam::acc-1:group/auditors" },
      ],
      next_marker: null,
    });
    api.addUser.mockImplementation(async (_account, group) => { memberships.add(group); });
    api.removeUser.mockImplementation(async (_account, group) => { memberships.delete(group); });
  });

  it("adds and removes memberships from the user workspace", async () => {
    renderPage();

    expect(await screen.findByText("operators")).toBeInTheDocument();
    expect(screen.getByText(/Associated: 1/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Search IAM groups")).not.toBeInTheDocument();
    expect(api.listGroups).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add to groups" }));
    await waitFor(() => expect(api.listGroups).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 }));
    expect(screen.queryByRole("checkbox", { name: /operators/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: /auditors/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.addUser).toHaveBeenCalledWith("acc-1", "auditors", "alice"));
    expect(await screen.findByText("auditors")).toBeInTheDocument();

    const operatorsRow = screen.getByText("operators").closest("tr");
    if (!operatorsRow) throw new Error("operators row not found");
    fireEvent.click(within(operatorsRow).getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove user from group?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove user" }));

    await waitFor(() => expect(api.removeUser).toHaveBeenCalledWith("acc-1", "operators", "alice"));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("operators")).not.toBeInTheDocument());
  });

  it("keeps selections across cursor pages and server-side searches", async () => {
    api.listGroups.mockImplementation(async (_contextId, query) => {
      if (query?.search === "secure") {
        return {
          items: [{ name: "security", arn: "arn:aws:iam::acc-1:group/security" }],
          next_marker: null,
        };
      }
      if (query?.marker === "page-2") {
        return {
          items: [{ name: "developers", arn: "arn:aws:iam::acc-1:group/developers" }],
          next_marker: null,
        };
      }
      return {
        items: [
          { name: "operators", arn: "arn:aws:iam::acc-1:group/operators" },
          { name: "auditors", arn: "arn:aws:iam::acc-1:group/auditors" },
        ],
        next_marker: "page-2",
      };
    });

    renderPage();
    await screen.findByText("operators");
    fireEvent.click(screen.getByRole("button", { name: "Add to groups" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /auditors/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listGroups).toHaveBeenCalledWith("acc-1", { marker: "page-2", page_size: 25 }));
    expect(await screen.findByRole("checkbox", { name: /developers/ })).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search IAM groups"), { target: { value: "secure" } });
    await waitFor(() => expect(api.listGroups).toHaveBeenCalledWith("acc-1", {
      marker: null,
      page_size: 25,
      search: "secure",
    }));
    expect(await screen.findByRole("checkbox", { name: /security/ })).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /security/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(api.addUser).toHaveBeenCalledWith("acc-1", "auditors", "alice");
      expect(api.addUser).toHaveBeenCalledWith("acc-1", "security", "alice");
    });
  });

  it("keeps only failed associations selected and retries them", async () => {
    api.listGroups.mockResolvedValue({
      items: [
        { name: "auditors", arn: "arn:aws:iam::acc-1:group/auditors" },
        { name: "developers", arn: "arn:aws:iam::acc-1:group/developers" },
      ],
      next_marker: null,
    });
    api.addUser.mockImplementationOnce(async (_account, group) => {
      memberships.add(group);
    }).mockRejectedValueOnce(new Error("RGW denied developers"))
      .mockImplementationOnce(async (_account, group) => {
        memberships.add(group);
      });

    renderPage();
    await screen.findByText("operators");
    fireEvent.click(screen.getByRole("button", { name: "Add to groups" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /auditors/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /developers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const failureHeading = await screen.findByText("Some associations could not be updated.");
    const failureAlert = failureHeading.closest('[role="alert"]');
    expect(failureAlert).not.toBeNull();
    expect(failureAlert).toHaveTextContent("developers: RGW denied developers");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /auditors/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /developers/ })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.addUser).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Group memberships updated")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search IAM groups")).not.toBeInTheDocument();
  });
});
