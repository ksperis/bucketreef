import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupPoliciesPage from "./ManagerGroupPoliciesPage";
import ManagerRolePoliciesPage from "./ManagerRolePoliciesPage";
import ManagerUserPoliciesPage from "./ManagerUserPoliciesPage";

const listIamPoliciesPageMock = vi.fn();
const listUserPoliciesMock = vi.fn();
const attachUserPolicyMock = vi.fn();
const listGroupPoliciesMock = vi.fn();
const attachGroupPolicyMock = vi.fn();
const listRolePoliciesMock = vi.fn();
const attachRolePolicyMock = vi.fn();
const listUserInlinePoliciesMock = vi.fn();
const listGroupInlinePoliciesMock = vi.fn();
const listRoleInlinePoliciesMock = vi.fn();

vi.mock("./ExecutionContextProvider", () => ({
  useExecutionContext: () => ({
    selectedContextKind: "account",
    contextIdForApi: "acc-1",
    requiresContextSelection: false,
    accessMode: "regular",
    contexts: [],
  }),
}));

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPoliciesPage: (...args: unknown[]) => listIamPoliciesPageMock(...args),
  };
});

vi.mock("../../api/managerIamUsers", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamUsers")>("../../api/managerIamUsers");
  return {
    ...actual,
    attachUserPolicy: (...args: unknown[]) => attachUserPolicyMock(...args),
    deleteUserInlinePolicy: vi.fn(),
    detachUserPolicy: vi.fn(),
    listUserInlinePolicies: (...args: unknown[]) => listUserInlinePoliciesMock(...args),
    listUserPolicies: (...args: unknown[]) => listUserPoliciesMock(...args),
    putUserInlinePolicy: vi.fn(),
  };
});

vi.mock("../../api/managerIamGroups", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamGroups")>("../../api/managerIamGroups");
  return {
    ...actual,
    attachGroupPolicy: (...args: unknown[]) => attachGroupPolicyMock(...args),
    deleteGroupInlinePolicy: vi.fn(),
    detachGroupPolicy: vi.fn(),
    listGroupInlinePolicies: (...args: unknown[]) => listGroupInlinePoliciesMock(...args),
    listGroupPolicies: (...args: unknown[]) => listGroupPoliciesMock(...args),
    putGroupInlinePolicy: vi.fn(),
  };
});

vi.mock("../../api/managerIamRoles", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamRoles")>("../../api/managerIamRoles");
  return {
    ...actual,
    attachRolePolicy: (...args: unknown[]) => attachRolePolicyMock(...args),
    deleteRoleInlinePolicy: vi.fn(),
    detachRolePolicy: vi.fn(),
    listRoleInlinePolicies: (...args: unknown[]) => listRoleInlinePoliciesMock(...args),
    listRolePolicies: (...args: unknown[]) => listRolePoliciesMock(...args),
    putRoleInlinePolicy: vi.fn(),
  };
});

type PageCase = {
  label: string;
  path: string;
  element: JSX.Element;
  attach: typeof attachUserPolicyMock;
};

const pages: PageCase[] = [
  {
    label: "user",
    path: "/manager/users/:userName/policies",
    element: <ManagerUserPoliciesPage />,
    attach: attachUserPolicyMock,
  },
  {
    label: "group",
    path: "/manager/groups/:groupName/policies",
    element: <ManagerGroupPoliciesPage />,
    attach: attachGroupPolicyMock,
  },
  {
    label: "role",
    path: "/manager/roles/:roleName/policies",
    element: <ManagerRolePoliciesPage />,
    attach: attachRolePolicyMock,
  },
];

describe("manager entity policy pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIamPoliciesPageMock.mockResolvedValue({ items: [], next_marker: null });
    listUserPoliciesMock.mockResolvedValue([]);
    listGroupPoliciesMock.mockResolvedValue([]);
    listRolePoliciesMock.mockResolvedValue([]);
    listUserInlinePoliciesMock.mockResolvedValue([{ name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } }]);
    listGroupInlinePoliciesMock.mockResolvedValue([{ name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } }]);
    listRoleInlinePoliciesMock.mockResolvedValue([{ name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } }]);
  });

  it.each(pages)("keeps existing inline policies visible on the $label page before editing", async ({ path, element }) => {
    const url = path.replace(":userName", "alice").replace(":groupName", "admins").replace(":roleName", "auditor");

    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    );

    const policyCell = await screen.findByText("readonly-inline", { selector: "td" });
    const row = policyCell.closest("tr")!;
    expect(within(row).getByText("0 statements • 2 top-level fields")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("Select an existing inline policy to review or edit.")).toBeInTheDocument();
  });

  it("does not expose a panel-local refresh action in the embedded user policies workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/manager/users/alice/policies"]}>
        <Routes>
          <Route path="/manager/users/:userName/policies" element={<ManagerUserPoliciesPage embedded />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("readonly-inline", { selector: "td" });
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("reloads managed and inline policies from the page-level refresh action", async () => {
    render(
      <MemoryRouter initialEntries={["/manager/users/alice/policies"]}>
        <Routes>
          <Route path="/manager/users/:userName/policies" element={<ManagerUserPoliciesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("readonly-inline", { selector: "td" });
    await waitFor(() => {
      expect(listUserPoliciesMock).toHaveBeenCalledTimes(1);
      expect(listUserInlinePoliciesMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(listUserPoliciesMock).toHaveBeenCalledTimes(2);
      expect(listUserInlinePoliciesMock).toHaveBeenCalledTimes(2);
    });
  });

  it.each(pages)("shows existing managed policies before opening the $label association picker", async ({ path, element }) => {
    const attached = { name: "ExistingPolicy", arn: "arn:aws:iam::acc-1:policy/ExistingPolicy" };
    const available = { name: "AvailablePolicy", arn: "arn:aws:iam::acc-1:policy/AvailablePolicy" };
    listIamPoliciesPageMock.mockResolvedValue({ items: [attached, available], next_marker: null });
    listUserPoliciesMock.mockResolvedValue([attached]);
    listGroupPoliciesMock.mockResolvedValue([attached]);
    listRolePoliciesMock.mockResolvedValue([attached]);
    const url = path.replace(":userName", "alice").replace(":groupName", "admins").replace(":roleName", "auditor");

    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("ExistingPolicy", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText(/Associated: 1/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Search policies")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach policies" }));

    const picker = await screen.findByRole("region", { name: "Attach policies" });
    expect(within(picker).queryByRole("checkbox", { name: /ExistingPolicy/ })).not.toBeInTheDocument();
    expect(within(picker).getByRole("checkbox", { name: /AvailablePolicy/ })).toBeInTheDocument();
    expect(within(picker).queryByRole("combobox", { name: "Page size" })).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Search policies")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(screen.getByRole("heading", { name: "Detach managed policy?" })).toBeInTheDocument();
  });
});


it.each(pages)("preserves the $label inline draft while a managed policy is attached", async ({ path, element, attach }) => {
  const policy = { name: "ManagedReadOnly", arn: "arn:aws:iam::acc-1:policy/ManagedReadOnly" };
  listIamPoliciesPageMock.mockResolvedValue({ items: [policy], next_marker: null });
  for (const list of [listUserPoliciesMock, listGroupPoliciesMock, listRolePoliciesMock]) list.mockResolvedValue([]);
  for (const list of [listUserInlinePoliciesMock, listGroupInlinePoliciesMock, listRoleInlinePoliciesMock]) {
    list.mockResolvedValue([{ name: "readonly-inline", document: {} }]);
  }
  let resolve!: (value: typeof policy) => void;
  attach.mockReset().mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const url = path.replace(/:(userName|groupName|roleName)/, "fixture");
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path={path} element={element} /></Routes></MemoryRouter>);
  const policyCell = await screen.findByText("readonly-inline", { selector: "td" });
  const edit = within(policyCell.closest("tr")!).getByRole("button", { name: "Edit" });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
  const document = screen.getByLabelText("Inline policy document (JSON)");
  fireEvent.change(document, { target: { value: '{"draft":true}' } });
  expect(screen.queryByLabelText("Search policies")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Attach policies" }));
  const managedPolicy = await screen.findByRole("checkbox", { name: /ManagedReadOnly/ });
  fireEvent.click(managedPolicy);
  const picker = screen.getByRole("region", { name: "Attach policies" });
  const attachButton = within(picker).getByRole("button", { name: "Attach" });
  await waitFor(() => expect(attachButton).toBeEnabled());
  fireEvent.click(attachButton);
  expect(managedPolicy).toBeDisabled();
  expect(within(picker).getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.click(attachButton);
  expect(attach).toHaveBeenCalledOnce();
  expect(attach).toHaveBeenCalledWith("acc-1", "fixture", policy);
  expect(document).toHaveValue('{"draft":true}');
  await act(async () => resolve(policy));
  await screen.findByText("Policies attached");
  expect(screen.getByLabelText("Inline policy document (JSON)")).toBe(document);
  expect(document).toHaveValue('{"draft":true}');
});
