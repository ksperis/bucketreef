import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddS3ConnectionFromKeyModal from "../AddS3ConnectionFromKeyModal";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";

const createConnectionMock = vi.fn();
const listStorageEndpointsMock = vi.fn();

vi.mock("../../api/connections", () => ({
  createConnection: (payload: unknown) => createConnectionMock(payload),
  listPrivateConnectionStorageEndpoints: () => listStorageEndpointsMock(),
}));

describe("AddS3ConnectionFromKeyModal", () => {
  beforeEach(() => {
    createConnectionMock.mockReset();
    listStorageEndpointsMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes execution contexts after creating a private connection", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const refreshListener = vi.fn();
    createConnectionMock.mockResolvedValue({ id: 7 });
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);

    render(
      <AddS3ConnectionFromKeyModal
        isOpen
        lockEndpoint
        accessKeyId="AKIA-EXAMPLE"
        secretAccessKey="SECRET-EXAMPLE"
        defaultName="private-connection"
        defaultEndpointUrl="https://s3.example.test"
        defaultAccessManager
        defaultAccessBrowser
        onClose={onClose}
        onCreated={onCreated}
      />
    );

    expect(screen.getByDisplayValue("private-connection")).toHaveClass("ui-control");
    await user.click(screen.getByRole("button", { name: "Create private connection" }));

    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshListener).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(refreshListener.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    expect(createConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "private-connection",
        endpoint_url: "https://s3.example.test",
        access_key_id: "AKIA-EXAMPLE",
        secret_access_key: "SECRET-EXAMPLE",
        access_manager: true,
        access_browser: true,
      })
    );

    window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);
  });

  it("asks before closing when connection fields changed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    listStorageEndpointsMock.mockResolvedValue([]);

    render(
      <AddS3ConnectionFromKeyModal
        isOpen
        lockEndpoint
        accessKeyId="AKIA-EXAMPLE"
        secretAccessKey="SECRET-EXAMPLE"
        defaultName="private-connection"
        defaultEndpointUrl="https://s3.example.test"
        defaultAccessManager
        defaultAccessBrowser
        onClose={onClose}
      />
    );

    const nameInput = screen.getByDisplayValue("private-connection");
    await user.clear(nameInput);
    await user.type(nameInput, "changed-connection");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders local validation errors with the shared inline treatment", async () => {
    const user = userEvent.setup();
    listStorageEndpointsMock.mockResolvedValue([]);

    render(
      <AddS3ConnectionFromKeyModal
        isOpen
        lockEndpoint
        accessKeyId="AKIA-EXAMPLE"
        secretAccessKey="SECRET-EXAMPLE"
        defaultName="private-connection"
        defaultEndpointUrl="https://s3.example.test"
        defaultAccessManager
        defaultAccessBrowser
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText("Access manager"));
    await user.click(screen.getByLabelText("Access browser"));
    await user.click(screen.getByRole("button", { name: "Create private connection" }));

    expect(screen.getByLabelText("Access browser")).toHaveAccessibleDescription(
      "At least one access must be enabled. Enable access to manager and/or browser."
    );
    expect(createConnectionMock).not.toHaveBeenCalled();
  });

  it("creates a custom endpoint connection through shared endpoint fields", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    createConnectionMock.mockResolvedValue({ id: 8 });
    listStorageEndpointsMock.mockResolvedValue([]);

    render(
      <AddS3ConnectionFromKeyModal
        isOpen
        accessKeyId="AKIA-CUSTOM"
        secretAccessKey="SECRET-CUSTOM"
        defaultName="custom-connection"
        defaultAccessBrowser
        onClose={onClose}
      />
    );

    const endpointUrlInput = await screen.findByLabelText("Endpoint URL");
    expect(endpointUrlInput).toHaveClass("ui-control");
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveClass("ui-control");

    await user.type(endpointUrlInput, "https://minio.example.test");
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "minio");
    await user.click(screen.getByLabelText("Force path style"));
    await user.click(screen.getByRole("button", { name: "Create private connection" }));

    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    expect(createConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "custom-connection",
        endpoint_url: "https://minio.example.test",
        provider_hint: "minio",
        force_path_style: true,
        verify_tls: true,
        access_key_id: "AKIA-CUSTOM",
        secret_access_key: "SECRET-CUSTOM",
      })
    );
  });
  const defaults = {
    isOpen: true, accessKeyId: "FIXTURE-ACCESS", secretAccessKey: "fixture-secret", defaultName: "Private connection",
    defaultEndpointId: 11, defaultEndpointUrl: "https://context.example.test", onClose: vi.fn(),
  };
  const endpoint = { id: 11, name: "Context endpoint", endpoint_url: "https://context.example.test", is_default: false };

  it("keeps a fixed endpoint clean and preserves its ID without loading the catalogue", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    createConnectionMock.mockResolvedValue({ id: 1 });
    render(<AddS3ConnectionFromKeyModal {...defaults} lockEndpoint onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(listStorageEndpointsMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create private connection" }));
    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    expect(createConnectionMock.mock.calls[0][0]).toMatchObject({ storage_endpoint_id: 11 });
    expect(createConnectionMock.mock.calls[0][0].endpoint_url).toBeUndefined();
  });

  it("retains the requested preset during a delayed catalogue load and does not invent a draft", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    let resolve!: (endpoints: unknown[]) => void;
    listStorageEndpointsMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AddS3ConnectionFromKeyModal {...defaults} onClose={onClose} />);
    expect(screen.getByRole("radio", { name: "Configured endpoint" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Create private connection" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Configured endpoint" })).toHaveValue("11");
    resolve([endpoint]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create private connection" })).toBeEnabled());
    expect(screen.getByRole("radio", { name: "Configured endpoint" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not silently replace an unavailable preset with another endpoint", async () => {
    const user = userEvent.setup();
    listStorageEndpointsMock.mockResolvedValue([{ ...endpoint, id: 22, name: "Other endpoint", is_default: true }]);
    createConnectionMock.mockResolvedValue({ id: 1 });
    render(<AddS3ConnectionFromKeyModal {...defaults} />);
    const select = screen.getByRole("combobox", { name: "Configured endpoint" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveValue("11");
    await user.click(screen.getByRole("button", { name: "Create private connection" }));
    expect(select).toHaveAccessibleDescription("Select an available configured endpoint.");
    await waitFor(() => expect(select).toHaveFocus());
    expect(createConnectionMock).not.toHaveBeenCalled();
    await user.selectOptions(select, "22");
    expect(select).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Create private connection" }));
    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    expect(createConnectionMock.mock.calls[0][0].storage_endpoint_id).toBe(22);
  });

  it("retains a requested preset after catalogue failure and allows explicit custom mode", async () => {
    const user = userEvent.setup();
    listStorageEndpointsMock.mockRejectedValue(new Error("Catalogue unavailable"));
    render(<AddS3ConnectionFromKeyModal {...defaults} />);
    await screen.findByText(/Endpoint list unavailable/);
    expect(screen.getByRole("radio", { name: "Configured endpoint" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Custom endpoint" }));
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue("https://context.example.test");
    expect(createConnectionMock).not.toHaveBeenCalled();
  });

  it("validates custom fields beside their inputs and clears errors when corrected", async () => {
    const user = userEvent.setup();
    listStorageEndpointsMock.mockResolvedValue([]);
    render(<AddS3ConnectionFromKeyModal {...defaults} defaultEndpointId={undefined} defaultEndpointUrl="" />);
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Create private connection" }));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Name is required.");
    expect(screen.getByLabelText("Endpoint URL")).toHaveAccessibleDescription("Endpoint URL is required for a custom endpoint.");
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    await user.type(screen.getByLabelText("Name"), "Fixed name");
    await user.type(screen.getByLabelText("Endpoint URL"), "invalid-url");
    await user.click(screen.getByRole("button", { name: "Create private connection" }));
    expect(screen.getByLabelText("Endpoint URL")).toHaveAccessibleDescription("Enter a valid endpoint URL.");
    await waitFor(() => expect(screen.getByLabelText("Endpoint URL")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://custom.example.test" } });
    expect(screen.queryAllByRole("textbox").every((input) => input.getAttribute("aria-invalid") !== "true")).toBe(true);
    expect(createConnectionMock).not.toHaveBeenCalled();
  });

  it("ignores inactive custom settings when the user returns to the original preset", async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    listStorageEndpointsMock.mockResolvedValue([endpoint]);
    render(<AddS3ConnectionFromKeyModal {...defaults} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create private connection" })).toBeEnabled());
    await user.click(screen.getByRole("radio", { name: "Custom endpoint" }));
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://draft.example.test" } });
    await user.click(screen.getByRole("radio", { name: "Configured endpoint" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
  });

  it("freezes the submitted draft and every close path, then retries the same payload after failure", async () => {
    const user = userEvent.setup(), onClose = vi.fn(), onCreated = vi.fn();
    let reject!: (error: Error) => void;
    createConnectionMock.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ id: 1 });
    listStorageEndpointsMock.mockResolvedValue([endpoint]);
    render(<AddS3ConnectionFromKeyModal {...defaults} onClose={onClose} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create private connection" })).toBeEnabled());
    await user.type(screen.getByLabelText("Name"), " updated{Enter}");
    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    const form = screen.getByLabelText("Name").closest("form")!;
    for (const control of screen.getByRole("dialog").querySelectorAll("input, select, button")) expect(control).toBeDisabled();
    fireEvent.submit(form);
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("presentation"));
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(createConnectionMock).toHaveBeenCalledTimes(1);
    reject(new Error("Fixture creation failure"));
    await screen.findByText("Fixture creation failure");
    expect(screen.getByLabelText("Name")).toHaveValue("Private connection updated");
    await user.click(screen.getByRole("button", { name: "Create private connection" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createConnectionMock.mock.calls[1]).toEqual(createConnectionMock.mock.calls[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

});
