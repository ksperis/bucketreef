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

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountType: "account",
    accountIdForApi: "acc-1",
    requiresS3AccountSelection: false,
    accessMode: "default",
  }),
}));

vi.mock("../../api/managerIamUsers", async (original) => ({
  ...await original<typeof import("../../api/managerIamUsers")>(),
  getIamUser: api.getUser,
}));

vi.mock("../../api/managerIamGroups", async (original) => ({
  ...await original<typeof import("../../api/managerIamGroups")>(),
  listIamGroups: api.listGroups,
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
    api.listGroups.mockResolvedValue([
      { name: "operators", arn: "arn:aws:iam::acc-1:group/operators" },
      { name: "auditors", arn: "arn:aws:iam::acc-1:group/auditors" },
    ]);
    api.addUser.mockImplementation(async (_account, group) => { memberships.add(group); });
    api.removeUser.mockImplementation(async (_account, group) => { memberships.delete(group); });
  });

  it("adds and removes memberships from the user workspace", async () => {
    renderPage();

    expect(await screen.findByText("operators")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "IAM group" }), { target: { value: "auditors" } });
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
});
