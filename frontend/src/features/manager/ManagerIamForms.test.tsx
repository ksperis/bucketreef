import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { transferableAbortController } from "node:util";
import { setSessionUserCache } from "../../utils/workspaces";
import PoliciesPage from "./PoliciesPage";
import ManagerUsersPage from "./ManagerUsersPage";
import ManagerGroupsPage from "./ManagerGroupsPage";
import ManagerRolesPage from "./ManagerRolesPage";

const api = vi.hoisted(() => ({
  users: vi.fn(), groups: vi.fn(), roles: vi.fn(), policies: vi.fn(),
  createUser: vi.fn(), createGroup: vi.fn(), createRole: vi.fn(), createPolicy: vi.fn(),
  attachGroup: vi.fn(), attachRole: vi.fn(), getRole: vi.fn(), updateRole: vi.fn(),
}));
vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({ selectedS3AccountId: "acc-7", selectedS3AccountType: "account",
    accountIdForApi: "acc-7", requiresS3AccountSelection: true, accessMode: "default" }),
}));
vi.mock("../../api/managerIamUsers", async (original) => ({
  ...await original<typeof import("../../api/managerIamUsers")>(),
  listIamUsers: api.users, createIamUser: api.createUser,
}));
vi.mock("../../api/managerIamGroups", async (original) => ({
  ...await original<typeof import("../../api/managerIamGroups")>(),
  listIamGroups: api.groups, createIamGroup: api.createGroup, attachGroupPolicy: api.attachGroup,
}));
vi.mock("../../api/managerIamRoles", async (original) => ({
  ...await original<typeof import("../../api/managerIamRoles")>(),
  listIamRoles: api.roles, createIamRole: api.createRole, attachRolePolicy: api.attachRole,
  getIamRole: api.getRole, updateIamRole: api.updateRole,
}));
vi.mock("../../api/managerIamPolicies", async (original) => ({
  ...await original<typeof import("../../api/managerIamPolicies")>(), listIamPolicies: api.policies, createIamPolicy: api.createPolicy,
}));

const policy = { name: "ReadOnly", arn: "arn:aws:iam::acc-7:policy/ReadOnly" };
const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: "arn:aws:iam::acc-7:root" }, Action: "sts:AssumeRole" }] };
const role = { name: "Existing role", path: "/application/", assume_role_policy_document: trust };
const cases = [
  { kind: "user", Page: ManagerUsersPage, create: api.createUser },
  { kind: "group", Page: ManagerGroupsPage, create: api.createGroup },
  { kind: "role", Page: ManagerRolesPage, create: api.createRole },
] as const;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSessionUserCache(null); });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  api.users.mockResolvedValue([{ name: "Existing user", has_keys: true }]);
  api.groups.mockResolvedValue([{ name: "Existing group" }]);
  api.roles.mockResolvedValue([role]);
  api.policies.mockResolvedValue([policy]);
  api.createUser.mockResolvedValue({ name: "New identity" });
  api.createGroup.mockResolvedValue({ name: "New identity" });
  api.createRole.mockResolvedValue({ name: "New identity" });
  api.createPolicy.mockResolvedValue({ name: "New identity" });
  api.attachGroup.mockResolvedValue(policy);
  api.attachRole.mockResolvedValue(policy);
  api.getRole.mockResolvedValue(role);
  api.updateRole.mockResolvedValue(role);
});

describe.each(cases)("IAM $kind creation", ({ kind, Page, create }) => {
  const nameLabel = `${kind[0].toUpperCase()}${kind.slice(1)} name`;
  const open = async () => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    await screen.findByText(`Existing ${kind}`);
    fireEvent.click(screen.getByRole("button", { name: `Create ${kind}`, exact: true }));
    return screen.getByRole("form", { name: `Create IAM ${kind}` });
  };

  it("focuses required identity and clears its message after correction", async () => {
    const form = await open();
    fireEvent.submit(form);
    const name = within(form).getByLabelText(nameLabel);
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription(`${nameLabel} is required.`);
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: " New identity " } });
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toBe("acc-7");
    if (kind === "role") expect(create.mock.calls[0][1]).toMatchObject({ name: "New identity", path: "/", inline_policies: [] });
    else expect(create.mock.calls[0][1]).toBe("New identity");
    if (kind === "user") expect(create.mock.calls[0].slice(2)).toEqual([true, [], [], []]);
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

  it("freezes the submitted draft and retries the identical request after failure", async () => {
    let reject!: (error: Error) => void;
    create.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const form = await open();
    fireEvent.change(within(form).getByLabelText(nameLabel), { target: { value: "New identity" } });
    fireEvent.submit(form);
    for (const field of form.querySelectorAll("fieldset input,fieldset textarea,fieldset button")) expect(field).toBeDisabled();
    expect(within(form).getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: `Back to ${kind}s` }));
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledOnce();
    expect(form).toBeInTheDocument();
    await act(async () => reject(new Error("Temporary creation failure")));
    expect(await within(form.closest(".workflow-page")!).findByText("Temporary creation failure")).toBeInTheDocument();
    expect(within(form).getByLabelText(nameLabel)).toHaveValue("New identity");
    fireEvent.submit(form);
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
});

it.each([
  { kind: "group", Page: ManagerGroupsPage, attach: api.attachGroup },
  { kind: "role", Page: ManagerRolesPage, attach: api.attachRole },
])("keeps the $kind draft frozen until policy attachment finishes", async ({ kind, Page, attach }) => {
  let resolve!: (value: typeof policy) => void;
  attach.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  render(<MemoryRouter><Page /></MemoryRouter>);
  await screen.findByText(`Existing ${kind}`);
  fireEvent.click(screen.getByRole("button", { name: `Create ${kind}`, exact: true }));
  const form = screen.getByRole("form", { name: `Create IAM ${kind}` });
  const name = within(form).getByLabelText(`${kind[0].toUpperCase()}${kind.slice(1)} name`);
  fireEvent.change(name, { target: { value: "New identity" } });
  const policies = within(screen.getByRole("region", { name: "Attach policies" }));
  fireEvent.click(policies.getByRole("button", { name: "Show" }));
  fireEvent.click(policies.getByLabelText("ReadOnly"));
  fireEvent.submit(form);
  await waitFor(() => expect(attach).toHaveBeenCalledWith("acc-7", "New identity", policy));
  expect(name).toBeDisabled();
  expect(within(form).getByRole("button", { name: "Creating..." })).toBeDisabled();
  await act(async () => resolve(policy));
  await waitFor(() => expect(form).not.toBeInTheDocument());
});

describe("IAM role configuration", () => {
  const open = async () => {
    render(<MemoryRouter><ManagerRolesPage /></MemoryRouter>);
    await screen.findByText(role.name);
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    return screen.findByRole("form", { name: "Edit IAM role" });
  };

  it("shares JSON validation between creation and editing", async () => {
    render(<MemoryRouter><ManagerRolesPage /></MemoryRouter>);
    await screen.findByText(role.name);
    fireEvent.click(screen.getByRole("button", { name: "Create role", exact: true }));
    const form = screen.getByRole("form", { name: "Create IAM role" });
    fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "New role" } });
    const document = within(form).getByLabelText("Assume role policy (JSON)");
    fireEvent.change(document, { target: { value: "{" } });
    fireEvent.submit(form);
    await waitFor(() => expect(document).toHaveFocus());
    expect(document).toHaveAccessibleDescription(/Assume role policy must be valid JSON\./);
    expect(api.createRole).not.toHaveBeenCalled();
    fireEvent.change(document, { target: { value: JSON.stringify(trust) } });
    expect(document).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.change(within(form).getByLabelText("Role path (optional)"), { target: { value: "" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.createRole).toHaveBeenCalledWith("acc-7", expect.objectContaining({ path: undefined, assume_role_policy_document: trust })));
  });

  it("keeps role identity read-only and preserves the draft after a failed update", async () => {
    let reject!: (error: Error) => void;
    api.updateRole.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const form = await open();
    expect(within(form).getByLabelText("Role name")).toHaveAttribute("readonly");
    expect(within(form).getByLabelText("Role path")).toHaveAttribute("readonly");
    expect(within(form).getByLabelText("Role path")).toHaveValue("/application/");
    const document = within(form).getByLabelText("Assume role policy (JSON)");
    fireEvent.change(document, { target: { value: "{" } });
    fireEvent.submit(form);
    await waitFor(() => expect(document).toHaveFocus());
    expect(api.updateRole).not.toHaveBeenCalled();
    expect(document).toHaveAccessibleDescription(/Assume role policy must be valid JSON\./);
    fireEvent.change(document, { target: { value: JSON.stringify(trust) } });
    expect(document).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(form);
    expect(document).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "Back to roles" }));
    expect(api.updateRole).toHaveBeenCalledOnce();
    expect(form).toBeInTheDocument();
    await act(async () => reject(new Error("Temporary update failure")));
    expect(await within(form.closest(".workflow-page")!).findByText("Temporary update failure")).toBeInTheDocument();
    expect(document).toHaveValue(JSON.stringify(trust));
    fireEvent.submit(form);
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(api.updateRole.mock.calls[1]).toEqual(api.updateRole.mock.calls[0]);
    expect(api.updateRole).toHaveBeenCalledWith("acc-7", role.name, { assume_role_policy_document: trust });
  });

  it("freezes role fields after a failed load and offers a fresh retry", async () => {
    api.getRole.mockRejectedValueOnce(new Error("Role details unavailable"));
    render(<MemoryRouter><ManagerRolesPage /></MemoryRouter>);
    await screen.findByText(role.name);
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    await screen.findByText("Role details unavailable");
    expect(screen.getByRole("textbox", { name: "Assume role policy (JSON)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(api.updateRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Assume role policy (JSON)" })).toBeEnabled());
    expect(api.getRole.mock.calls).toEqual([["acc-7", role.name], ["acc-7", role.name]]);
  });
});


it("ignores a late role read after closing and reopening its editor", async () => {
  let resolveOld!: (value: typeof role) => void;
  api.getRole.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  render(<MemoryRouter><ManagerRolesPage /></MemoryRouter>);
  await screen.findByText(role.name);
  fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
  expect(screen.getByRole("textbox", { name: "Assume role policy (JSON)" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Back to roles" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
  const policy = screen.getByRole("textbox", { name: "Assume role policy (JSON)" });
  await waitFor(() => expect(policy).toBeEnabled());
  fireEvent.change(policy, { target: { value: "unsaved draft" } });
  await act(async () => resolveOld(role));
  expect(policy).toHaveValue("unsaved draft");
});

const navigationCases = [
  ...cases.map(({ kind, Page, create }) => ({ kind, Page, mutate: create,
    action: `Create ${kind}`, formName: `Create IAM ${kind}`, fieldName: `${kind[0].toUpperCase()}${kind.slice(1)} name`, draft: "Unsaved identity" })),
  { kind: "policy", Page: PoliciesPage, mutate: api.createPolicy, action: "Create policy", formName: "Create IAM policy", fieldName: "Policy name", draft: "Unsaved policy" },
  { kind: "edit-role", Page: ManagerRolesPage, mutate: api.updateRole, action: "Edit", formName: "Edit IAM role", fieldName: "Assume role policy (JSON)", draft: '{"Version":"2012-10-17","Statement":[]}' },
];

it.each(navigationCases)("protects the $kind form through context navigation, pending work and error retry", async ({ Page, mutate, action, formName, fieldName, draft }) => {
  const user = userEvent.setup();
  setSessionUserCache({ role: "ui_user", authType: "password" });
  let reject!: (error: Error) => void;
  mutate.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const router = createMemoryRouter([
    { path: "/edit", element: <Page /> },
    { path: "/next", element: <p>Next workspace page</p> },
  ], { initialEntries: ["/edit?ctx=acc-7"] });
  render(<RouterProvider router={router} />);
  await user.click(await screen.findByRole("button", { name: action, exact: true }));
  const form = screen.getByRole("form", { name: formName });
  const field = within(form).getByRole("textbox", { name: fieldName });
  await waitFor(() => expect(field).toBeEnabled());
  fireEvent.change(field, { target: { value: draft } });
  await act(async () => { void router.navigate("/edit?ctx=conn-8"); });
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(router.state.location.search).toBe("?ctx=acc-7");
  expect(field).toHaveValue(draft);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.submit(form);
  expect(mutate).toHaveBeenCalledOnce();
  await act(async () => { void router.navigate("/next"); });
  expect(screen.getByRole("dialog", { name: "Operation in progress" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Discard changes", exact: true })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(field).toBeDisabled();
  await act(async () => reject(new Error("Temporary IAM failure")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Temporary IAM failure");
  expect(field).toHaveValue(draft);
  fireEvent.submit(form);
  await waitFor(() => expect(form).not.toBeInTheDocument());
  expect(mutate.mock.calls[0]).toEqual(mutate.mock.calls[1]);
  expect(mutate.mock.calls[1][0]).toBe("acc-7");
  const saved = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(saved);
  expect(saved.defaultPrevented).toBe(false);
  router.dispose();
});
