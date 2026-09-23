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

const docs = "https://docs.bucketreef.ksperis.com/ops/production-checks-reference/";

const report: ProductionReadinessResponse = {
  environment: "production",
  profile: "admin",
  status: "critical",
  counts: { blocked: 0, critical: 1, warning: 1, manual: 1, ok: 2 },
  findings: [
    {
      code: "app-env",
      label: "Production environment",
      result: "pass",
      severity: "critical",
      level: "ok",
      message: "APP_ENV is production.",
      documentation_url: docs + "#app-env",
      blocks_startup: false,
    },
    {
      code: "admin-passkey-policy",
      label: "Administrator passkey policy",
      result: "fail",
      severity: "critical",
      level: "critical",
      message: "Enable administrator passkeys.",
      documentation_url: docs + "#admin-passkey-policy",
      blocks_startup: false,
    },
    {
      code: "database",
      label: "Database topology",
      result: "pass",
      severity: "critical",
      level: "ok",
      message: "PostgreSQL is configured.",
      documentation_url: docs + "#database-topology",
      blocks_startup: false,
    },
    {
      code: "job-owner",
      label: "Scheduled job ownership",
      result: "fail",
      severity: "warning",
      level: "warning",
      message: "Review scheduled jobs.",
      documentation_url: docs + "#scheduled-job-ownership",
      blocks_startup: false,
    },
    {
      code: "manual-backup-restore",
      label: "Backup and restore test",
      result: "manual",
      severity: null,
      level: "manual",
      message: "Confirm restore evidence.",
      documentation_url: docs + "#manual-backup-restore",
      blocks_startup: false,
    },
  ],
};

describe("ProductionReadinessPage", () => {
  beforeEach(() => {
    fetchProductionReadinessMock.mockReset();
    fetchProductionReadinessMock.mockResolvedValue(report);
  });

  it("groups blockers, critical findings, warnings, manual checks and OK results", async () => {
    render(<ProductionReadinessPage />);

    expect(await screen.findByText("Runtime summary")).toBeInTheDocument();
    expect(screen.getByText(/evaluates the production target for this backend instance/i)).toBeInTheDocument();
    expect(screen.getByText("Administrator passkey policy")).toBeInTheDocument();
    expect(screen.getByText("Backup and restore test")).toBeInTheDocument();
    expect(screen.getByText("Critical", { selector: "dt" }).parentElement).toHaveTextContent("1");
    expect(screen.getByText("Manual", { selector: "dt" }).parentElement).toHaveTextContent("1");
    const successfulChecks = screen.getByText("Show 2 successful checks").closest("details");
    expect(successfulChecks).not.toHaveAttribute("open");
    expect(screen.getAllByRole("link", { name: "Documentation" })).toHaveLength(report.findings.length);
  });

  it("refreshes the report on demand", async () => {
    render(<ProductionReadinessPage />);
    await screen.findByText("Runtime summary");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetchProductionReadinessMock).toHaveBeenCalledTimes(2));
  });
});
