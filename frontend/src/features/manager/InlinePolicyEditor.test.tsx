import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IAMEntity, NamingValidationProfile } from "../../utils/resourceNames";
import InlinePolicyEditor from "./InlinePolicyEditor";

const loadPoliciesMock = vi.fn();
const savePolicyMock = vi.fn();
const deletePolicyMock = vi.fn();

const readonlyPolicy = {
  name: "readonly-inline",
  document: {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
  },
};

function renderEditor({
  entityType = "user",
  namingValidationProfile = "standard",
  refreshToken = 0,
}: {
  entityType?: IAMEntity;
  namingValidationProfile?: NamingValidationProfile;
  refreshToken?: number;
} = {}) {
  return render(
    <InlinePolicyEditor
      entityLabel={entityType}
      entityType={entityType}
      namingValidationProfile={namingValidationProfile}
      entityName="alice"
      loadPolicies={loadPoliciesMock}
      savePolicy={savePolicyMock}
      deletePolicy={deletePolicyMock}
      refreshToken={refreshToken}
    />,
  );
}

async function openEditDialog() {
  const policyCell = await screen.findByText("readonly-inline", { selector: "td" });
  const row = policyCell.closest("tr")!;
  const edit = within(row).getByRole("button", { name: "Edit" });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
  const dialog = screen.getByRole("dialog", { name: "Edit inline policy — readonly-inline" });
  const form = within(dialog).getByRole("form", { name: "Edit inline policy" });
  return { dialog, form };
}

describe("InlinePolicyEditor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadPoliciesMock.mockResolvedValue([readonlyPolicy]);
    savePolicyMock.mockResolvedValue(undefined);
    deletePolicyMock.mockResolvedValue(undefined);
  });

  it("keeps the page compact until an inline policy is edited", async () => {
    renderEditor();

    expect(await screen.findByText("readonly-inline", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Policy" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByText("1 statement • 2 top-level fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create inline policy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.queryByText("Existing inline policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Inline policy name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Inline policy document (JSON)")).not.toBeInTheDocument();
  });

  it("opens an existing policy in a wide edit dialog with a locked name", async () => {
    renderEditor();
    const { dialog } = await openEditDialog();

    const name = within(dialog).getByLabelText("Inline policy name");
    expect(name).toHaveValue("readonly-inline");
    expect(name).toHaveAttribute("readonly");
    expect((within(dialog).getByLabelText("Inline policy document (JSON)") as HTMLTextAreaElement).value).toContain('"Action": [');
    expect(within(dialog).getByRole("button", { name: "Format JSON" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Insert template" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete inline policy" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("creates a policy from a dedicated dialog and closes it after saving", async () => {
    loadPoliciesMock.mockResolvedValueOnce([readonlyPolicy]).mockResolvedValueOnce([
      readonlyPolicy,
      { name: "new-inline", document: {} },
    ]);
    renderEditor();
    await screen.findByText("readonly-inline");

    fireEvent.click(screen.getByRole("button", { name: "Create inline policy" }));
    const dialog = screen.getByRole("dialog", { name: "Create inline policy" });
    const form = within(dialog).getByRole("form", { name: "Create inline policy" });
    const name = within(form).getByLabelText("Inline policy name");
    expect(name).not.toHaveAttribute("readonly");
    fireEvent.change(name, { target: { value: " new-inline " } });
    fireEvent.submit(form);

    await waitFor(() => expect(savePolicyMock).toHaveBeenCalledWith("new-inline", {}));
    expect(await screen.findByText("Inline policy saved.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create inline policy" })).not.toBeInTheDocument();
    expect(loadPoliciesMock).toHaveBeenCalledTimes(2);
  });

  it("validates create names and JSON while preserving focus on the invalid field", async () => {
    renderEditor({ namingValidationProfile: "ceph" });
    await screen.findByText("readonly-inline");
    fireEvent.click(screen.getByRole("button", { name: "Create inline policy" }));

    const form = screen.getByRole("form", { name: "Create inline policy" });
    const name = within(form).getByLabelText("Inline policy name");
    const document = within(form).getByLabelText("Inline policy document (JSON)");

    fireEvent.submit(form);
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription("Inline policy name is required.");

    fireEvent.change(name, { target: { value: "invalid_under+score" } });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(/Ceph inline policy name/);
    fireEvent.change(name, { target: { value: "valid:policy" } });
    fireEvent.change(document, { target: { value: "{" } });
    fireEvent.submit(form);
    await waitFor(() => expect(document).toHaveFocus());
    expect(document).toHaveAccessibleDescription(/Inline policy must be valid JSON/);
    expect(savePolicyMock).not.toHaveBeenCalled();
  });

  it("updates the persisted policy document, refreshes the list, and closes the dialog", async () => {
    const updated = { ...readonlyPolicy, document: { Version: "2012-10-17", Statement: [] } };
    loadPoliciesMock.mockResolvedValueOnce([readonlyPolicy]).mockResolvedValueOnce([updated]);
    renderEditor();
    const { form } = await openEditDialog();

    const document = within(form).getByLabelText("Inline policy document (JSON)");
    fireEvent.change(document, { target: { value: '{"Version":"2012-10-17","Statement":[]}' } });
    fireEvent.submit(form);

    await waitFor(() => expect(savePolicyMock).toHaveBeenCalledWith("readonly-inline", {
      Version: "2012-10-17",
      Statement: [],
    }));
    expect(await screen.findByText("Inline policy updated.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit inline policy — readonly-inline" })).not.toBeInTheDocument();
    expect(loadPoliciesMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed save open with the draft intact", async () => {
    savePolicyMock.mockRejectedValueOnce(new Error("Temporary inline failure"));
    renderEditor();
    const { form } = await openEditDialog();
    const document = within(form).getByLabelText("Inline policy document (JSON)");
    fireEvent.change(document, { target: { value: '{"pending":true}' } });
    fireEvent.submit(form);

    expect(await within(form).findByText("Temporary inline failure")).toBeInTheDocument();
    expect(document).toHaveValue('{"pending":true}');
    expect(screen.getByRole("dialog", { name: "Edit inline policy — readonly-inline" })).toBeInTheDocument();
  });

  it.each(["cancel", "close", "escape", "backdrop"] as const)(
    "protects unsaved changes when closing through %s",
    async (closePath) => {
      renderEditor();
      let { dialog, form } = await openEditDialog();
      const document = within(form).getByLabelText("Inline policy document (JSON)");
      fireEvent.change(document, { target: { value: '{"pending":true}' } });

      const requestClose = () => {
        dialog = screen.getByRole("dialog", { name: "Edit inline policy — readonly-inline" });
        form = within(dialog).getByRole("form", { name: "Edit inline policy" });
        if (closePath === "cancel") fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
        if (closePath === "close") fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
        if (closePath === "escape") fireEvent.keyDown(document, { key: "Escape" });
        if (closePath === "backdrop") fireEvent.mouseDown(dialog.parentElement!);
      };

      requestClose();
      let confirm = screen.getByRole("dialog", { name: "Discard changes?" });
      fireEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));
      expect(screen.getByLabelText("Inline policy document (JSON)")).toHaveValue('{"pending":true}');

      requestClose();
      confirm = screen.getByRole("dialog", { name: "Discard changes?" });
      fireEvent.click(within(confirm).getByRole("button", { name: "Discard changes" }));
      expect(screen.queryByRole("dialog", { name: "Edit inline policy — readonly-inline" })).not.toBeInTheDocument();
    },
  );

  it("deletes the selected persisted policy through explicit confirmation", async () => {
    loadPoliciesMock.mockResolvedValueOnce([readonlyPolicy]).mockResolvedValueOnce([]);
    renderEditor();
    const { dialog } = await openEditDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete inline policy" }));

    const confirm = screen.getByRole("dialog", { name: "Delete inline policy?" });
    expect(within(confirm).getByText("readonly-inline")).toBeInTheDocument();
    expect(within(confirm).getByText("alice")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete inline policy" }));

    await waitFor(() => expect(deletePolicyMock).toHaveBeenCalledWith("readonly-inline"));
    expect(await screen.findByText("Inline policy deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit inline policy — readonly-inline" })).not.toBeInTheDocument();
    expect(loadPoliciesMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes the compact list when the parent refresh token changes", async () => {
    loadPoliciesMock.mockResolvedValueOnce([readonlyPolicy]).mockResolvedValueOnce([
      readonlyPolicy,
      { name: "write-inline", document: {} },
    ]);
    const { rerender } = renderEditor();
    await screen.findByText("readonly-inline");
    rerender(
      <InlinePolicyEditor
        entityLabel="user"
        entityType="user"
        namingValidationProfile="standard"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
        refreshToken={1}
      />,
    );

    expect(await screen.findByText("write-inline")).toBeInTheDocument();
    expect(loadPoliciesMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it.each(["user", "group"] as const)("uses Ceph %s policy naming rules only when creating", async (entityType) => {
  vi.resetAllMocks();
  loadPoliciesMock.mockResolvedValue([{ name: "legacy_under+score", document: {} }]);
  savePolicyMock.mockResolvedValue(undefined);
  renderEditor({ entityType, namingValidationProfile: "ceph" });
  await screen.findByText("legacy_under+score");

  const row = screen.getByText("legacy_under+score", { selector: "td" }).closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
  const editDialog = screen.getByRole("dialog", { name: "Edit inline policy — legacy_under+score" });
  expect(within(editDialog).getByLabelText("Inline policy name")).toHaveAttribute("readonly");
  fireEvent.click(within(editDialog).getByRole("button", { name: "Cancel" }));

  fireEvent.click(screen.getByRole("button", { name: "Create inline policy" }));
  const createForm = screen.getByRole("form", { name: "Create inline policy" });
  const name = within(createForm).getByLabelText("Inline policy name");
  fireEvent.change(name, { target: { value: "invalid_under+score" } });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription(/Ceph inline policy name/);
});
