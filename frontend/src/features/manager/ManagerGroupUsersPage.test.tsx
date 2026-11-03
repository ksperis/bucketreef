import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupUsersPage from "./ManagerGroupUsersPage";

const useExecutionContextMock = vi.fn();
const listIamGroupUsersMock = vi.fn();
const listIamUsersPageMock = vi.fn();
const addIamGroupUserMock = vi.fn();
const removeIamGroupUserMock = vi.fn();

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => useExecutionContextMock(),
}));

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    addIamGroupUser: (...args: unknown[]) => addIamGroupUserMock(...args),
    listIamGroupUsers: (...args: unknown[]) => listIamGroupUsersMock(...args),
    removeIamGroupUser: (...args: unknown[]) => removeIamGroupUserMock(...args),
  };
});

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    listIamUsersPage: (...args: unknown[]) => listIamUsersPageMock(...args),
  };
});

function renderPage(embedded = false) {
  return render(
      <MemoryRouter initialEntries={["/manager/groups/operators/members"]}>
      <Routes>
          <Route path="/manager/groups/:groupName/members" element={<ManagerGroupUsersPage embedded={embedded} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ManagerGroupUsersPage", () => {
  beforeEach(() => {
    useExecutionContextMock.mockReset();
    listIamGroupUsersMock.mockReset();
    listIamUsersPageMock.mockReset();
    addIamGroupUserMock.mockReset().mockResolvedValue(undefined);
    removeIamGroupUserMock.mockReset().mockResolvedValue(undefined);
    useExecutionContextMock.mockReturnValue({
      selectedContextKind: "account",
      contextIdForApi: "acc-1",
      requiresContextSelection: false,
      accessMode: "default",
    });
    listIamGroupUsersMock.mockResolvedValue([]);
    listIamUsersPageMock.mockResolvedValue({ items: [], next_marker: null });
  });

  it("shows current members first and adds an available user through the picker", async () => {
    const members = new Set(["alice"]);
    listIamGroupUsersMock.mockImplementation(async () => [...members].map((name) => ({
      name,
      arn: `arn:aws:iam::acc-1:user/${name}`,
    })));
    addIamGroupUserMock.mockImplementation(async (_contextId, _groupName, userName) => {
      members.add(String(userName));
    });
    listIamUsersPageMock.mockResolvedValue({
      items: [{
        name: "alice",
        arn: "arn:aws:iam::acc-1:user/alice",
      },
      {
        name: "bob",
        arn: "arn:aws:iam::acc-1:user/bob",
      }],
      next_marker: null,
    });

    renderPage();

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText(/Associated: 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add members" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search IAM users")).not.toBeInTheDocument();
    expect(listIamUsersPageMock).not.toHaveBeenCalled();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("alice").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.queryByRole("columnheader", { name: "ARN" })).not.toBeInTheDocument();
    expect(screen.queryByText("arn:aws:iam::acc-1:user/alice")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" }).closest("td")).toHaveAttribute(
      "data-mobile-actions",
      "true"
    );
    expect(listIamGroupUsersMock).toHaveBeenCalledWith("acc-1", "operators");

    fireEvent.click(screen.getByRole("button", { name: "Add members" }));
    await waitFor(() => expect(listIamUsersPageMock).toHaveBeenCalledWith("acc-1", { marker: null, page_size: 25 }));
    expect(screen.queryByRole("checkbox", { name: /alice/ })).not.toBeInTheDocument();
    const bob = await screen.findByRole("checkbox", { name: /bob/ });
    expect(screen.queryByRole("combobox", { name: "Page size" })).not.toBeInTheDocument();
    fireEvent.click(bob);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addIamGroupUserMock).toHaveBeenCalledWith("acc-1", "operators", "bob"));
    expect(await screen.findByText("Members added")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search IAM users")).not.toBeInTheDocument();
    expect(await screen.findByText("bob")).toBeInTheDocument();

    const aliceRow = screen.getByText("alice").closest("tr");
    if (!aliceRow) throw new Error("alice row not found");
    fireEvent.click(within(aliceRow).getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("heading", { name: "Remove user from group?" })).toBeInTheDocument();
    expect(screen.getByText("Permissions inherited only through this group will no longer apply to the user.")).toBeInTheDocument();
    expect(removeIamGroupUserMock).not.toHaveBeenCalled();
  });

  it("shows an explicit empty state with the add action available", async () => {
    renderPage();

    expect(await screen.findByText("No members in this group.")).toBeInTheDocument();
    expect(screen.getByText(/Associated: 0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add members" })).toBeEnabled();
  });

  it("keeps embedded member actions and count in the shared list toolbar", async () => {
    renderPage(true);

    expect(await screen.findByText("No members in this group.")).toBeInTheDocument();
    const toolbar = screen.getByRole("region", { name: "Members" });
    expect(toolbar).toHaveAttribute("data-list-variant", "page");
    expect(within(toolbar).getByText("Associated: 0")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Add members" })).toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });
});
