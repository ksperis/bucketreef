import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InlinePolicyEditor from "./InlinePolicyEditor";

const loadPoliciesMock = vi.fn();
const savePolicyMock = vi.fn();
const deletePolicyMock = vi.fn();

describe("InlinePolicyEditor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps existing inline policies visible before anything is selected", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
        },
      },
    ]);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    expect(await screen.findByText("Existing inline policies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /readonly-inline/i })).toBeInTheDocument();
    expect(screen.getByText("Select an existing inline policy to review or edit")).toBeInTheDocument();
    expect(screen.queryByLabelText("Inline policy name")).not.toBeInTheDocument();
  });

  it("loads an existing inline policy into the editor and switches the CTA to update", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
        },
      },
    ]);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading inline policies...")).not.toBeInTheDocument();
    });

    fireEvent.click((await screen.findAllByRole("button", { name: /readonly-inline/i }))[0]);

    expect(await screen.findByLabelText("Inline policy name")).toHaveValue("readonly-inline");
    expect((screen.getByLabelText("Inline policy document (JSON)") as HTMLTextAreaElement).value).toContain('"Action": [');
    expect(screen.getByRole("button", { name: "Update existing inline policy" })).toBeInTheDocument();
  });

  it("warns when saving with the name of another existing inline policy", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
        },
      },
      {
        name: "write-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:PutObject"], Resource: "*" }],
        },
      },
    ]);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading inline policies...")).not.toBeInTheDocument();
    });

    fireEvent.click((await screen.findAllByRole("button", { name: /readonly-inline/i }))[0]);
    fireEvent.change(await screen.findByLabelText("Inline policy name"), { target: { value: "write-inline" } });

    expect(screen.getByText(/will replace that existing inline policy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace existing inline policy" })).toBeInTheDocument();
  });

  it("confirms inline policy deletion with the affected entity", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: { Version: "2012-10-17", Statement: [] },
      },
    ]);
    deletePolicyMock.mockResolvedValue(undefined);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    fireEvent.click((await screen.findAllByRole("button", { name: /readonly-inline/i }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete inline policy" }));

    expect(screen.getByRole("heading", { name: "Delete inline policy?" })).toBeInTheDocument();
    expect(screen.getAllByText("alice").length).toBeGreaterThan(0);
    expect(deletePolicyMock).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete inline policy" }));
    await waitFor(() => expect(deletePolicyMock).toHaveBeenCalledWith("readonly-inline"));
  });
});


describe("inline policy draft safety", () => {
  const existing = { name: "readonly-inline", document: { Version: "2012-10-17", Statement: [] } };
  const open = async () => {
    loadPoliciesMock.mockResolvedValue([existing, { name: "write-inline", document: {} }]);
    render(<InlinePolicyEditor entityLabel="user" entityName="alice" loadPolicies={loadPoliciesMock}
      savePolicy={savePolicyMock} deletePolicy={deletePolicyMock} />);
    const choice = await screen.findByRole("button", { name: /readonly-inline/ });
    await waitFor(() => expect(choice).toBeEnabled());
    fireEvent.click(choice);
    return screen.getByRole("form", { name: "Edit inline policy" });
  };

  beforeEach(() => vi.resetAllMocks());

  it("associates validation errors and keeps blank JSON as an empty document", async () => {
    const form = await open();
    const name = within(form).getByLabelText("Inline policy name");
    const document = within(form).getByLabelText("Inline policy document (JSON)");
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.submit(form);
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription("Inline policy name is required.");
    fireEvent.change(name, { target: { value: " NewInline " } });
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.change(document, { target: { value: "{" } });
    fireEvent.submit(form);
    await waitFor(() => expect(document).toHaveFocus());
    expect(document).toHaveAccessibleDescription(/Inline policy must be valid JSON/);
    expect(savePolicyMock).not.toHaveBeenCalled();
    fireEvent.change(document, { target: { value: " " } });
    expect(document).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.submit(form);
    await waitFor(() => expect(savePolicyMock).toHaveBeenCalledWith("NewInline", {}));
  });

  it("freezes every editor action during save and retries the preserved draft", async () => {
    let reject!: (error: Error) => void;
    savePolicyMock.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const form = await open();
    const document = within(form).getByLabelText("Inline policy document (JSON)");
    fireEvent.change(document, { target: { value: '{"Statement":[]}' } });
    fireEvent.submit(form);
    for (const control of screen.getAllByRole("button")) expect(control).toBeDisabled();
    expect(document).toBeDisabled();
    fireEvent.submit(form);
    expect(savePolicyMock).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Temporary inline failure")));
    expect(await screen.findByText("Temporary inline failure")).toBeInTheDocument();
    expect(document).toHaveValue('{"Statement":[]}');
    expect(document).toBeEnabled();
    fireEvent.submit(form);
    await screen.findByText("Inline policy updated.");
    expect(savePolicyMock.mock.calls[1]).toEqual(savePolicyMock.mock.calls[0]);
  });

  it.each(["selection", "create", "cancel", "refresh"])("protects unsaved changes before %s", async (action) => {
    const form = await open();
    const document = within(form).getByLabelText("Inline policy document (JSON)");
    fireEvent.change(document, { target: { value: '{"pending":true}' } });
    const target = action === "selection" ? screen.getByRole("button", { name: /write-inline/ })
      : screen.getByRole("button", { name: action === "create" ? "Create new inline policy" : action === "cancel" ? "Cancel" : "Refresh", exact: true });
    fireEvent.click(target);
    let dialog = screen.getByRole("dialog", { name: "Discard changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(document).toHaveValue('{"pending":true}');
    expect(loadPoliciesMock).toHaveBeenCalledOnce();
    fireEvent.click(target);
    dialog = screen.getByRole("dialog", { name: "Discard changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    if (action === "cancel") expect(form).not.toBeInTheDocument();
    else if (action === "refresh") await waitFor(() => expect(document).toHaveValue(JSON.stringify(existing.document, null, 2)));
    else expect(within(form).getByLabelText("Inline policy name")).toHaveValue(action === "create" ? "" : "write-inline");
    expect(savePolicyMock).not.toHaveBeenCalled();
  });

  it("keeps deletion explicit and targets the selected persisted policy", async () => {
    let resolve!: () => void;
    deletePolicyMock.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Inline policy name"), { target: { value: "Unsaved name" } });
    fireEvent.click(within(form).getByRole("button", { name: "Delete inline policy" }));
    const dialog = screen.getByRole("dialog", { name: "Delete inline policy?" });
    expect(within(dialog).getByText("readonly-inline")).toBeInTheDocument();
    expect(deletePolicyMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete inline policy" }));
    await waitFor(() => expect(deletePolicyMock).toHaveBeenCalledWith("readonly-inline"));
    expect(within(form).getByLabelText("Inline policy name")).toBeDisabled();
    expect(within(form).getByRole("button", { name: "Save new inline policy" })).toBeDisabled();
    await act(async () => resolve());
    await screen.findByText("Inline policy deleted.");
  });
});
