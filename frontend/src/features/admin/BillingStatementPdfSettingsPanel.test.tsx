import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BillingStatementPdfSettingsPanel from "./BillingStatementPdfSettingsPanel";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  preview: vi.fn(),
  createObjectUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock("../../api/billing", () => ({
  getBillingStatementPdfSettings: () => mocks.getSettings(),
  updateBillingStatementPdfSettings: (...args: unknown[]) => mocks.updateSettings(...args),
  previewBillingStatementPdf: (...args: unknown[]) => mocks.preview(...args),
}));

const settings = {
  organization_name: "BucketReef",
  organization_details: null,
  accent_color: "#0569f8",
  logo_data_url: null,
  statement_note: null,
  footer_text: null,
};

describe("BillingStatementPdfSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(settings);
    mocks.updateSettings.mockImplementation(async (payload) => payload);
    mocks.preview.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    mocks.createObjectUrl.mockReturnValue("blob:billing-preview");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectUrl,
    });
  });

  it("saves current branding settings", async () => {
    render(<BillingStatementPdfSettingsPanel />);
    const name = await screen.findByLabelText("Organization name");
    fireEvent.change(name, { target: { value: "Research IT" } });
    fireEvent.change(screen.getByLabelText("Statement note"), {
      target: { value: "Internal chargeback" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith({
      ...settings,
      organization_name: "Research IT",
      statement_note: "Internal chargeback",
    }));
    expect(await screen.findByText("Billing Statement PDF settings saved.")).toBeInTheDocument();
  });

  it("renders a server preview from the unsaved draft", async () => {
    render(<BillingStatementPdfSettingsPanel />);
    await screen.findByLabelText("Organization name");
    fireEvent.change(screen.getByLabelText("Footer"), {
      target: { value: "Infrastructure department" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));

    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith({
      ...settings,
      footer_text: "Infrastructure department",
    }));
    expect(mocks.createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(await screen.findByLabelText("Billing Statement PDF preview")).toHaveAttribute(
      "data",
      "blob:billing-preview",
    );
  });

  it("warns before browser navigation when the persistent editor is dirty", async () => {
    render(<BillingStatementPdfSettingsPanel />);
    const name = await screen.findByLabelText("Organization name");
    fireEvent.change(name, { target: { value: "Research IT" } });

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
});
