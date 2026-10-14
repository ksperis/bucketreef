import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { transferableAbortController } from "node:util";
import { setSessionUserCache } from "../../utils/workspaces";
import PoliciesPage from "./PoliciesPage";
import ManagerUsersPage from "./ManagerUsersPage";
import ManagerGroupsPage from "./ManagerGroupsPage";
import ManagerRoleEditor from "./ManagerRoleEditor";
import ManagerRolesPage from "./ManagerRolesPage";

const api = vi.hoisted(() => ({
  namingProfile: "standard" as "standard" | "ceph" | null,
  users: vi.fn(), groups: vi.fn(), roles: vi.fn(), policies: vi.fn(),
  createUser: vi.fn(), createGroup: vi.fn(), createRole: vi.fn(), createPolicy: vi.fn(),
  attachGroup: vi.fn(), attachRole: vi.fn(), getRole: vi.fn(), updateRole: vi.fn(),
  putRoleTags: vi.fn(), deleteRoleTag: vi.fn(),
}));
vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => ({ selectedS3AccountId: "acc-7", selectedS3AccountType: "account",
    namingValidationProfile: api.namingProfile, accountIdForApi: "acc-7", requiresS3AccountSelection: true, accessMode: "default" }),
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
  putRoleTags: api.putRoleTags, deleteRoleTag: api.deleteRoleTag,
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

it.each(cases)("blocks $kind creation while an attempted inline draft has a required-field error", async ({ kind, Page, create }) => {
  render(<MemoryRouter><Page /></MemoryRouter>);
  await screen.findByText(`Existing ${kind}`);
  fireEvent.click(screen.getByRole("button", { name: `Create ${kind}`, exact: true }));
  const form = screen.getByRole("form", { name: `Create IAM ${kind}` });
  fireEvent.change(within(form).getByLabelText(`${kind[0].toUpperCase()}${kind.slice(1)} name`), { target: { value: "valid-name" } });
  fireEvent.click(within(screen.getByRole("region", { name: "Inline policies (optional)" })).getByRole("button", { name: "Show inline policies" }));
  const name = within(form).getByLabelText("Inline policy name");
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("Inline policy name is required.");
  fireEvent.submit(form);
  expect(create).not.toHaveBeenCalled();
  await waitFor(() => expect(name).toBeEnabled());
  fireEvent.change(name, { target: { value: "valid-policy" } });
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  fireEvent.submit(form);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSessionUserCache(null); });

beforeEach(() => {
  vi.resetAllMocks();
  api.namingProfile = "standard";
  vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
  api.users.mockResolvedValue([{ name: "Existing user", has_keys: true }]);
  api.groups.mockResolvedValue([{ name: "Existing group" }]);
  api.roles.mockResolvedValue([role]);
  api.policies.mockResolvedValue([policy]);
  api.createUser.mockResolvedValue({ name: "New-identity" });
  api.createGroup.mockResolvedValue({ name: "New-identity" });
  api.createRole.mockResolvedValue({ name: "New-identity" });
  api.createPolicy.mockResolvedValue({ name: "New-identity" });
  api.attachGroup.mockResolvedValue(policy);
  api.attachRole.mockResolvedValue(policy);
  api.getRole.mockResolvedValue(role);
  api.updateRole.mockResolvedValue(role);
  api.putRoleTags.mockResolvedValue([]);
  api.deleteRoleTag.mockResolvedValue([]);
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
    fireEvent.change(name, { target: { value: " New-identity " } });
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toBe("acc-7");
    if (kind === "role") expect(create.mock.calls[0][1]).toMatchObject({ name: "New-identity", path: "/", inline_policies: [] });
    else expect(create.mock.calls[0][1]).toBe("New-identity");
    if (kind === "user") expect(create.mock.calls[0].slice(2)).toEqual([true, [], [], []]);
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

  it("freezes the submitted draft and retries the identical request after failure", async () => {
    let reject!: (error: Error) => void;
    create.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const form = await open();
    fireEvent.change(within(form).getByLabelText(nameLabel), { target: { value: "New-identity" } });
    fireEvent.submit(form);
    for (const field of form.querySelectorAll("fieldset input,fieldset textarea,fieldset button")) expect(field).toBeDisabled();
    expect(within(form).getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: `Back to ${kind}s` }));
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledOnce();
    expect(form).toBeInTheDocument();
    await act(async () => reject(new Error("Temporary creation failure")));
    expect(await within(form.closest(".workflow-page")!).findByText("Temporary creation failure")).toBeInTheDocument();
    expect(within(form).getByLabelText(nameLabel)).toHaveValue("New-identity");
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
  fireEvent.change(name, { target: { value: "New-identity" } });
  const policies = within(screen.getByRole("region", { name: "Attach policies" }));
  fireEvent.click(policies.getByRole("button", { name: "Show" }));
  fireEvent.click(policies.getByLabelText("ReadOnly"));
  fireEvent.submit(form);
  await waitFor(() => expect(attach).toHaveBeenCalledWith("acc-7", "New-identity", policy));
  expect(name).toBeDisabled();
  expect(within(form).getByRole("button", { name: "Creating..." })).toBeDisabled();
  await act(async () => resolve(policy));
  await waitFor(() => expect(form).not.toBeInTheDocument());
});

describe("IAM role configuration", () => {
  const open = async () => {
    render(
      <MemoryRouter>
        <ManagerRoleEditor accountId="acc-7" roleName={role.name} onClose={() => undefined} onSaved={() => undefined} />
      </MemoryRouter>,
    );
    return screen.findByRole("form", { name: "Edit IAM role" });
  };

  it("shares JSON validation between creation and editing", async () => {
    render(<MemoryRouter><ManagerRolesPage /></MemoryRouter>);
    await screen.findByText(role.name);
    fireEvent.click(screen.getByRole("button", { name: "Create role", exact: true }));
    const form = screen.getByRole("form", { name: "Create IAM role" });
    fireEvent.change(within(form).getByLabelText("Role name"), { target: { value: "New-role" } });
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
    const changedTrust = { Version: "2012-10-17", Statement: [] };
    expect(within(form).getByLabelText("Role name")).toHaveAttribute("readonly");
    expect(within(form).getByLabelText("Role path")).toHaveAttribute("readonly");
    expect(within(form).getByLabelText("Role path")).toHaveValue("/application/");
    const document = within(form).getByLabelText("Assume role policy (JSON)");
    fireEvent.change(document, { target: { value: "{" } });
    fireEvent.submit(form);
    await waitFor(() => expect(document).toHaveFocus());
    expect(api.updateRole).not.toHaveBeenCalled();
    expect(document).toHaveAccessibleDescription(/Assume role policy must be valid JSON\./);
    fireEvent.change(document, { target: { value: JSON.stringify(changedTrust) } });
    expect(document).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(form);
    expect(document).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "Back to roles" }));
    expect(api.updateRole).toHaveBeenCalledOnce();
    expect(form).toBeInTheDocument();
    await act(async () => reject(new Error("Temporary update failure")));
    expect(await within(form.closest(".workflow-page")!).findByText("Temporary update failure")).toBeInTheDocument();
    expect(document).toHaveValue(JSON.stringify(trust, null, 2));
    fireEvent.change(document, { target: { value: JSON.stringify(changedTrust) } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
    expect(form).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(api.updateRole.mock.calls[1]).toEqual(api.updateRole.mock.calls[0]);
    expect(api.updateRole).toHaveBeenCalledWith("acc-7", role.name, { assume_role_policy_document: changedTrust });
  });

  it("updates maximum session duration without rewriting an unchanged trust policy", async () => {
    const form = await open();
    const duration = within(form).getByLabelText("Maximum session duration (seconds)");
    fireEvent.change(duration, { target: { value: "7200" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith("acc-7", role.name, { max_session_duration: 7200 }));
  });

  it("replaces all values for a changed multi-valued role tag key", async () => {
    api.getRole.mockResolvedValueOnce({
      ...role,
      tags: [{ key: "team", value: "storage" }, { key: "team", value: "research" }],
    });
    const form = await open();
    const removeButtons = within(form).getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[0]);
    fireEvent.submit(form);
    await waitFor(() => expect(api.deleteRoleTag).toHaveBeenCalledWith("acc-7", role.name, "team"));
    expect(api.putRoleTags).toHaveBeenCalledWith("acc-7", role.name, [{ key: "team", value: "research" }]);
    expect(api.updateRole).not.toHaveBeenCalled();
  });

  it("freezes role fields after a failed load and offers a fresh retry", async () => {
    api.getRole.mockRejectedValueOnce(new Error("Role details unavailable"));
    render(
      <MemoryRouter>
        <ManagerRoleEditor accountId="acc-7" roleName={role.name} onClose={() => undefined} onSaved={() => undefined} />
      </MemoryRouter>,
    );
    await screen.findByText("Role details unavailable");
    expect(screen.getByRole("textbox", { name: "Assume role policy (JSON)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(api.updateRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Assume role policy (JSON)" })).toBeEnabled());
    expect(api.getRole.mock.calls).toEqual([["acc-7", role.name], ["acc-7", role.name]]);
  });
});


it("ignores a late role read after remounting its editor", async () => {
  let resolveOld!: (value: typeof role) => void;
  api.getRole.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const view = render(
    <MemoryRouter>
      <ManagerRoleEditor accountId="acc-7" roleName={role.name} onClose={() => undefined} onSaved={() => undefined} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("textbox", { name: "Assume role policy (JSON)" })).toBeDisabled();
  view.rerender(<MemoryRouter><div /></MemoryRouter>);
  view.rerender(
    <MemoryRouter>
      <ManagerRoleEditor accountId="acc-7" roleName={role.name} onClose={() => undefined} onSaved={() => undefined} />
    </MemoryRouter>,
  );
  const policy = screen.getByRole("textbox", { name: "Assume role policy (JSON)" });
  await waitFor(() => expect(policy).toBeEnabled());
  fireEvent.change(policy, { target: { value: "unsaved draft" } });
  await act(async () => resolveOld(role));
  expect(policy).toHaveValue("unsaved draft");
});

const navigationCases = [
  ...cases.map(({ kind, Page, create }) => ({ kind, Page, mutate: create,
    action: `Create ${kind}`, formName: `Create IAM ${kind}`, fieldName: `${kind[0].toUpperCase()}${kind.slice(1)} name`, draft: "Unsaved-identity" })),
  { kind: "policy", Page: PoliciesPage, mutate: api.createPolicy, action: "Create policy", formName: "Create IAM policy", fieldName: "Policy name", draft: "Unsaved-policy" },
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


it.each([...cases, { kind: "policy", Page: PoliciesPage, create: api.createPolicy }])("immediately marks invalid $kind names and blocks submission until corrected", async ({ kind, Page, create }) => {
  render(<MemoryRouter><Page /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: `Create ${kind}`, exact: true }));
  const form = screen.getByRole("form", { name: `Create IAM ${kind}` });
  const name = within(form).getByLabelText(`${kind[0].toUpperCase()}${kind.slice(1)} name`);
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.change(name, { target: { value: "bad*name" } });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription(/ASCII letters/);
  fireEvent.submit(form);
  expect(create).not.toHaveBeenCalled();
  await waitFor(() => expect(name).toHaveFocus());
  fireEvent.change(name, { target: { value: "valid-name_+=,.@" } });
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.submit(form);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
});

it.each(cases)("validates $kind inline drafts according to Ceph before creating the principal", async ({ kind, Page, create }) => {
  api.namingProfile = "ceph";
  render(<MemoryRouter><Page /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: `Create ${kind}`, exact: true }));
  const form = screen.getByRole("form", { name: `Create IAM ${kind}` });
  fireEvent.change(within(form).getByLabelText(`${kind[0].toUpperCase()}${kind.slice(1)} name`), { target: { value: "valid-name" } });
  fireEvent.click(within(screen.getByRole("region", { name: "Inline policies (optional)" })).getByRole("button", { name: "Show inline policies" }));
  const policyName = within(form).getByLabelText("Inline policy name");
  fireEvent.change(policyName, { target: { value: "inline_under+score" } });
  if (kind !== "role") {
    expect(policyName).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
    fireEvent.submit(form);
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(policyName).toBeEnabled());
    fireEvent.change(policyName, { target: { value: "inline:valid" } });
  }
  expect(policyName).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  fireEvent.submit(form);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  const expectedName = kind === "role" ? "inline_under+score" : "inline:valid";
  if (kind === "role") expect(create.mock.calls[0][1]).toMatchObject({ inline_policies: [{ name: expectedName, document: {} }] });
  else expect(create.mock.calls[0][kind === "user" ? 5 : 2]).toEqual([{ name: expectedName, document: {} }]);
});
