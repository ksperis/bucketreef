import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";

import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import CreateManagedPrivateAccessModal from "./CreateManagedPrivateAccessModal";

const createIamMock = vi.fn();
const createRgwUserMock = vi.fn();
const fullAccessPolicyArn = "arn:aws:iam::aws:policy/AmazonS3FullAccess";

vi.mock("../../api/managedPrivateAccess", async () => {
  const actual = await vi.importActual<typeof import("../../api/managedPrivateAccess")>("../../api/managedPrivateAccess");
  return {
    ...actual,
    createManagedIAMPrivateAccess: (...args: unknown[]) => createIamMock(...args),
    createManagedRGWUserPrivateAccess: (...args: unknown[]) => createRgwUserMock(...args),
  };
});

describe("CreateManagedPrivateAccessModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createIamMock.mockResolvedValue({
      provisioning_id: 12,
      status: "active",
      connection: { id: 44, name: "Personal browser", server_managed: true },
    });
    createRgwUserMock.mockResolvedValue({
      provisioning_id: 13,
      status: "active",
      connection: { id: 45, name: "Personal RGW", server_managed: true },
    });
  });

  it("submits the compact IAM default with Browser and AmazonS3FullAccess", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const refreshListener = vi.fn();
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);

    render(
      <CreateManagedPrivateAccessModal
        variant="iam"
        accountId="acc-7"
        contextName="account-test"
        groups={[{ name: "readers" }]}
        policies={[{ name: "ReadOnly", arn: "arn:policy:readonly" }]}
        onClose={onClose}
        onCreated={onCreated}
      />
    );

    expect(screen.getByText(/dedicated IAM user with AmazonS3FullAccess/i)).toBeInTheDocument();
    expect(screen.getByText(/secret is stored only on the server/i)).toBeInTheDocument();
    expect(screen.getByText("Advanced configuration").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByLabelText(/IAM user/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/access key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Connection name")).toHaveValue("account-test private access");
    await waitFor(() => expect(screen.getByLabelText("Connection name")).toHaveFocus());

    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "Personal browser");
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    await waitFor(() => {
      expect(createIamMock).toHaveBeenCalledWith("acc-7", {
        connection_name: "Personal browser",
        access_browser: true,
        access_manager: false,
        groups: [],
        managed_policies: [fullAccessPolicyArn],
        inline_policies: [],
      });
    });
    expect(refreshListener).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith("Personal browser");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/AKIA|secret_access_key/i)).not.toBeInTheDocument();
    window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);
  });

  it("allows the advanced IAM configuration to replace the default policy", async () => {
    const user = userEvent.setup();

    render(
      <CreateManagedPrivateAccessModal
        variant="iam"
        accountId="acc-7"
        groups={[{ name: "readers" }]}
        policies={[{ name: "ReadOnly", arn: "arn:policy:readonly" }]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "Personal browser");
    await user.click(screen.getByText("Advanced configuration"));
    const fullAccess = screen.getByRole("checkbox", { name: "AmazonS3FullAccess" });
    expect(fullAccess).toBeChecked();
    await user.click(fullAccess);
    await user.click(screen.getByText("readers"));
    await user.click(screen.getByText("ReadOnly"));
    await user.type(screen.getByLabelText("Inline policy name"), "audit");
    await user.click(screen.getByRole("button", { name: "Add inline policy" }));
    await user.click(screen.getByRole("checkbox", { name: "Access manager" }));
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    await waitFor(() => {
      expect(createIamMock).toHaveBeenCalledWith("acc-7", {
        connection_name: "Personal browser",
        access_browser: true,
        access_manager: true,
        groups: ["readers"],
        managed_policies: ["arn:policy:readonly"],
        inline_policies: [{ name: "audit", document: { Version: "2012-10-17", Statement: [] } }],
      });
    });
    expect(screen.getByText("Customized")).toBeInTheDocument();
  });

  it("keeps the RGW User payload limited to name and explicit workspace flags", async () => {
    const user = userEvent.setup();
    render(
      <CreateManagedPrivateAccessModal
        variant="rgw_user"
        accountId="s3u-9"
        contextName="rgw-user-test"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.queryByText("IAM groups")).not.toBeInTheDocument();
    expect(screen.queryByText("Managed policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Inline policies")).not.toBeInTheDocument();
    expect(screen.getByText(/new access key for this RGW user/i)).toBeInTheDocument();
    expect(screen.getByText("Advanced configuration").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Connection name")).toHaveValue("rgw-user-test private access");
    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "Personal RGW");
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    await waitFor(() => {
      expect(createRgwUserMock).toHaveBeenCalledWith("s3u-9", {
        connection_name: "Personal RGW",
        access_browser: true,
        access_manager: false,
      });
    });
  });

  it("keeps workspace validation inside the RGW advanced configuration", async () => {
    const user = userEvent.setup();
    render(
      <CreateManagedPrivateAccessModal
        variant="rgw_user"
        accountId="s3u-9"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await user.click(screen.getByText("Advanced configuration"));
    await user.click(screen.getByRole("checkbox", { name: "Access browser" }));
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enable Browser, Manager, or both.");
    expect(createRgwUserMock).not.toHaveBeenCalled();
  });

  it("has no detectable accessibility violations in the compact IAM state", async () => {
    const { container } = render(
      <CreateManagedPrivateAccessModal
        variant="iam"
        accountId="acc-7"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(await axe(container)).toHaveNoViolations();
  });
  it("protects an unadded inline draft on every dismissal path and can discard it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateManagedPrivateAccessModal variant="iam" accountId="acc-7" onClose={onClose} onCreated={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Create my private access" });
    await user.click(screen.getByText("Advanced configuration"));
    await user.type(screen.getByLabelText("Inline policy name"), "unadded-draft");
    for (const dismiss of [
      () => user.click(within(dialog).getByRole("button", { name: "Cancel", exact: true })),
      () => user.click(within(dialog).getByRole("button", { name: "Close modal" })),
      () => user.keyboard("{Escape}"),
      () => fireEvent.mouseDown(dialog.parentElement!),
    ]) {
      await dismiss();
      expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.getByLabelText("Inline policy name")).toHaveValue("unadded-draft");
    }
    await user.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
    await user.click(screen.getByRole("button", { name: "Discard changes", exact: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createIamMock).not.toHaveBeenCalled();
  });

  it("does not treat opening advanced configuration or restoring defaults as a dirty draft", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateManagedPrivateAccessModal variant="iam" accountId="acc-7" onClose={onClose} onCreated={vi.fn()} />);
    await user.click(screen.getByText("Advanced configuration"));
    await user.click(screen.getByRole("checkbox", { name: "Access manager" }));
    await user.click(screen.getByRole("checkbox", { name: "Access manager" }));
    await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
  });

  it.each(["iam", "rgw_user"] as const)("freezes the %s draft and dismissal until failure, then retries the same context and payload", async (variant) => {
    const user = userEvent.setup();
    const api = variant === "iam" ? createIamMock : createRgwUserMock;
    const accountId = variant === "iam" ? "acc-7" : "s3u-9";
    let reject!: (reason: Error) => void;
    api.mockImplementationOnce(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }));
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<CreateManagedPrivateAccessModal variant={variant} accountId={accountId} onClose={onClose} onCreated={onCreated} />);
    const dialog = screen.getByRole("dialog");
    await user.click(screen.getByText("Advanced configuration"));
    await user.click(screen.getByRole("checkbox", { name: "Access manager" }));
    const form = screen.getByLabelText("Connection name").closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const originalCall = api.mock.calls[0];
    for (const control of dialog.querySelectorAll("input, textarea, button")) expect(control).toBeDisabled();
    fireEvent.submit(form);
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
    expect(api).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    reject(new Error("Fixture provisioning failed"));
    await screen.findByText("Fixture provisioning failed");
    expect(screen.getByLabelText("Connection name")).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Access manager" })).toBeChecked();
    fireEvent.submit(form);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[1]).toEqual(originalCall);
    expect(originalCall[0]).toBe(accountId);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates a blank connection name beside the field and clears the error when corrected", async () => {
    const user = userEvent.setup();
    render(<CreateManagedPrivateAccessModal variant="iam" accountId="acc-7" onClose={vi.fn()} onCreated={vi.fn()} />);
    const name = screen.getByLabelText("Connection name");
    await user.clear(name);
    await user.type(name, "   ");
    await user.click(screen.getByRole("button", { name: "Create my private access" }));
    expect(name).toHaveAccessibleDescription("Connection name is required.");
    await waitFor(() => expect(name).toHaveFocus());
    expect(createIamMock).not.toHaveBeenCalled();
    await user.type(name, "Fixed");
    expect(name).not.toHaveAttribute("aria-invalid", "true");
  });

  it("keeps inline object validation and unique names local to the draft fields", async () => {
    const user = userEvent.setup();
    render(<CreateManagedPrivateAccessModal variant="iam" accountId="acc-7" onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.click(screen.getByText("Advanced configuration"));
    const name = screen.getByLabelText("Inline policy name");
    const document = screen.getByLabelText("Inline policy document");
    const add = screen.getByRole("button", { name: "Add inline policy" });
    await user.click(add);
    expect(name).toHaveAccessibleDescription("Inline policy name is required.");
    await waitFor(() => expect(name).toHaveFocus());
    await user.type(name, "audit");
    for (const invalid of ["{", "[]", "null", "true"]) {
      fireEvent.change(document, { target: { value: invalid } });
      await user.click(add);
      expect(document).toHaveAccessibleDescription(expect.stringContaining("must be a JSON object"));
      await waitFor(() => expect(document).toHaveFocus());
    }
    fireEvent.change(document, { target: { value: '{}' } });
    await user.click(add);
    await user.type(name, "audit");
    await user.click(add);
    expect(name).toHaveAccessibleDescription("Inline policy names must be unique.");
    await user.click(screen.getByRole("button", { name: "Remove inline policy audit" }));
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    expect(createIamMock).not.toHaveBeenCalled();
  });

  it("reveals and focuses workspace validation when advanced configuration is closed", async () => {
    const user = userEvent.setup();
    render(<CreateManagedPrivateAccessModal variant="rgw_user" accountId="s3u-9" onClose={vi.fn()} onCreated={vi.fn()} />);
    const advanced = screen.getByText("Advanced configuration");
    await user.click(advanced);
    await user.click(screen.getByRole("checkbox", { name: "Access browser" }));
    await user.click(advanced);
    await user.click(screen.getByRole("button", { name: "Create my private access" }));
    expect(advanced.closest("details")).toHaveAttribute("open");
    const manager = screen.getByRole("checkbox", { name: "Access manager" });
    expect(manager).toHaveAccessibleDescription(expect.stringContaining("Enable Browser, Manager, or both."));
    await waitFor(() => expect(manager).toHaveFocus());
    await user.click(manager);
    expect(manager).not.toHaveAttribute("aria-invalid", "true");
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  });

});
