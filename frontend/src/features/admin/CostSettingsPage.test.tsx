import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CostSettingsPage from "./CostSettingsPage";

const mocks = vi.hoisted(() => ({
  fetchCostSettings: vi.fn(),
  updateCostSettings: vi.fn(),
  listStorageEndpoints: vi.fn(),
}));

vi.mock("../../api/cost", () => ({
  fetchCostSettings: (...args: unknown[]) => mocks.fetchCostSettings(...args),
  updateCostSettings: (...args: unknown[]) => mocks.updateCostSettings(...args),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: (...args: unknown[]) => mocks.listStorageEndpoints(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/cost-settings"]}>
      <CostSettingsPage />
    </MemoryRouter>,
  );
}

const model = {
  currency: "EUR",
  storage_gb_month_price: 0.02,
  egress_gb_price: 0.03,
  ingress_gb_price: 0.01,
  requests_per_1000_price: 0.004,
};

const endpoint = {
  id: 7,
  name: "Ceph main",
  endpoint_url: "https://rgw.example.test",
  provider: "ceph",
  is_default: true,
};

describe("CostSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStorageEndpoints.mockResolvedValue([endpoint]);
    mocks.fetchCostSettings.mockResolvedValue({ model, endpoint_overrides: [] });
    mocks.updateCostSettings.mockImplementation(async (payload) => payload);
  });

  it("shows the global model and endpoint fallback", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Cost settings" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("EUR")).toBeInTheDocument();
    expect(screen.getByText("Ceph main")).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add override" })).toBeInTheDocument();
  });

  it("creates a complete endpoint override from the global rates and saves it", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Add override" }));
    expect(screen.getByText("Override")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateCostSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateCostSettings).toHaveBeenCalledWith({
      model,
      endpoint_overrides: [
        {
          storage_endpoint_id: 7,
          storage_gb_month_price: 0.02,
          egress_gb_price: 0.03,
          ingress_gb_price: 0.01,
          requests_per_1000_price: 0.004,
        },
      ],
    });
  });

  it("allows preparing a new global model from an empty configuration", async () => {
    mocks.fetchCostSettings.mockResolvedValue({ model: null, endpoint_overrides: [] });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("No cost model configured")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Configure model" }));

    expect(screen.getByDisplayValue("EUR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });
});
