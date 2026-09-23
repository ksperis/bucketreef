import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductionReadinessResponse } from "../../api/productionReadiness";
import ProductionReadinessPage from "./ProductionReadinessPage";

const fetchProductionReadinessMock = vi.fn<() => Promise<ProductionReadinessResponse>>();

vi.mock("../../api/productionReadiness", async () => {
  const actual = await vi.importActual<typeof import("../../api/productionReadiness")>("../../api/productionReadiness");
  return {
    ...actual,
    fetchProductionReadiness: () => fetchProductionReadinessMock(),
  };
});

const report: ProductionReadinessResponse = {
  profile: "admin",
  status: "warning",
  counts: { pass: 2, warning: 1, fail: 0 },
  findings: [
    { code: "app-env", label: "Production environment", level: "pass", message: "APP_ENV is production." },
    { code: "database", label: "Database", level: "pass", message: "Split deployment uses PostgreSQL." },
    { code: "job-owner", label: "Scheduled job ownership", level: "warning", message: "Review scheduled jobs." },
  ],
};

describe("ProductionReadinessPage", () => {
  beforeEach(() => {
    fetchProductionReadinessMock.mockReset();
    fetchProductionReadinessMock.mockResolvedValue(report);
  });

  it("shows the current-instance scope, profile, counts and findings", async () => {
    render(<ProductionReadinessPage />);

    expect(await screen.findByText("Runtime summary")).toBeInTheDocument();
    expect(screen.getByText(/evaluates only this backend instance/i)).toBeInTheDocument();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.getByText("Production environment")).toBeInTheDocument();
    expect(screen.getByText("Scheduled job ownership")).toBeInTheDocument();
    expect(screen.getByText("Failures").parentElement).toHaveTextContent("0");
  });

  it("refreshes the report on demand", async () => {
    render(<ProductionReadinessPage />);
    await screen.findByText("Runtime summary");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetchProductionReadinessMock).toHaveBeenCalledTimes(2));
  });
});
