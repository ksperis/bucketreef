import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerGroupPoliciesPage from "./ManagerGroupPoliciesPage";
import ManagerRolePoliciesPage from "./ManagerRolePoliciesPage";
import ManagerUserPoliciesPage from "./ManagerUserPoliciesPage";

const listIamPoliciesMock = vi.fn();
const listUserPoliciesMock = vi.fn();
const attachUserPolicyMock = vi.fn();
const listGroupPoliciesMock = vi.fn();
const attachGroupPolicyMock = vi.fn();
const listRolePoliciesMock = vi.fn();
const attachRolePolicyMock = vi.fn();
const listUserInlinePoliciesMock = vi.fn();
const listGroupInlinePoliciesMock = vi.fn();
const listRoleInlinePoliciesMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountType: "tenant",
    accountIdForApi: "acc-1",
    requiresS3AccountSelection: false,
    accessMode: "regular",
    accounts: [],
  }),
}));

vi.mock("../../api/managerIamPolicies", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerIamPolicies")>("../../api/managerIamPolicies");
  return {
    ...actual,
    listIamPolicies: (...args: unknown[]) => listIamPoliciesMock(...args),
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
    listIamPoliciesMock.mockResolvedValue([]);
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

    expect(await screen.findByText("Existing inline policies")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /readonly-inline/i })).toBeInTheDocument();
    expect(screen.getByText("Select an existing inline policy to review or edit.")).toBeInTheDocument();
  });
});


it.each(pages)("preserves the $label inline draft while a managed policy is attached", async ({ path, element, attach }) => {
  const policy = { name: "ManagedReadOnly", arn: "arn:aws:iam::acc-1:policy/ManagedReadOnly" };
  listIamPoliciesMock.mockResolvedValue([policy]);
  for (const list of [listUserPoliciesMock, listGroupPoliciesMock, listRolePoliciesMock]) list.mockResolvedValue([]);
  for (const list of [listUserInlinePoliciesMock, listGroupInlinePoliciesMock, listRoleInlinePoliciesMock]) {
    list.mockResolvedValue([{ name: "readonly-inline", document: {} }]);
  }
  let resolve!: (value: typeof policy) => void;
  attach.mockReset().mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const url = path.replace(/:(userName|groupName|roleName)/, "fixture");
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path={path} element={element} /></Routes></MemoryRouter>);
  const choice = await screen.findByRole("button", { name: /readonly-inline/ });
  await waitFor(() => expect(choice).toBeEnabled());
  fireEvent.click(choice);
  const document = screen.getByLabelText("Inline policy document (JSON)");
  fireEvent.change(document, { target: { value: '{"draft":true}' } });
  const form = screen.getByRole("form", { name: "Attach managed policy" });
  await waitFor(() => expect(within(form).getByRole("button", { name: "Attach" })).toBeEnabled());
  fireEvent.submit(form);
  expect(within(form).getByLabelText("Managed policy")).toBeDisabled();
  fireEvent.submit(form);
  expect(attach).toHaveBeenCalledOnce();
  expect(attach).toHaveBeenCalledWith("acc-1", "fixture", policy);
  expect(document).toHaveValue('{"draft":true}');
  await act(async () => resolve(policy));
  await screen.findByText("Policy attached");
  expect(screen.getByLabelText("Inline policy document (JSON)")).toBe(document);
  expect(document).toHaveValue('{"draft":true}');
});
