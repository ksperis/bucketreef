import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CostSubjectDetailPage from "./CostSubjectDetailPage";

const mocks = vi.hoisted(() => ({
  getCostSubjectDetail: vi.fn(),
}));

vi.mock("../../api/cost", () => ({
  getCostSubjectDetail: (...args: unknown[]) => mocks.getCostSubjectDetail(...args),
}));

vi.mock("recharts", () => {
  const Chart = ({ children }: { children?: ReactNode }) => <div data-testid="detail-chart">{children}</div>;
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Area: () => null,
    AreaChart: Chart,
    Bar: () => null,
    BarChart: Chart,
    CartesianGrid: () => null,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function renderDetail(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/cost/subject/:subjectType/:subjectId" element={<CostSubjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CostSubjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCostSubjectDetail.mockResolvedValue({
      month: "2026-07",
      storage_endpoint_id: 7,
      storage_endpoint_name: "Ceph main",
      subject_type: "account",
      subject_id: 42,
      name: "Tenant A",
      rgw_identifier: "rgw-42",
      daily: [
        {
          day: "2026-07-01",
          storage_bytes: 2048,
          bytes_in: 512,
          bytes_out: 1024,
          ops_total: 250,
        },
      ],
      usage: { bytes_in: 512, bytes_out: 1024, ops_total: 250 },
      storage: { avg_bytes: 2048, avg_gb_month: 0.0000019, total_objects: 4 },
      coverage: {
        days_collected: 2,
        days_in_month: 31,
        coverage_ratio: 2 / 31,
        storage_days_collected: 1,
        usage_days_collected: 2,
      },
      cost: {
        storage_cost: 2,
        egress_cost: 1,
        ingress_cost: 0,
        requests_cost: 0.75,
        total_cost: 3.75,
        currency: "EUR",
        pricing_source: "global",
      },
    });
  });

  it("loads endpoint-scoped detail, shows daily charts, and preserves the return URL", async () => {
    const returnTo = "/admin/cost?month=2026-07&type=all&tab=subjects&page=2";
    renderDetail(
      `/admin/cost/subject/account/42?month=2026-07&endpoint_id=7&return_to=${encodeURIComponent(returnTo)}`,
    );

    expect(await screen.findByRole("heading", { name: "Tenant A" })).toBeInTheDocument();
    expect(mocks.getCostSubjectDetail).toHaveBeenCalledWith("2026-07", 7, "account", 42);
    expect(screen.getByText("Ceph main · 2026-07 · RGW Account")).toBeInTheDocument();
    expect(screen.getByText("RGW identifier: rgw-42")).toBeInTheDocument();
    expect(screen.getByText(/Cost coverage is partial for this subject/)).toBeInTheDocument();
    expect(screen.getByText("This subject has partial source coverage: Storage 1d · Usage 2d.")).toBeInTheDocument();
    expect(screen.getAllByTestId("detail-chart")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Back to Cost" })).toHaveAttribute("href", returnTo);
  });

  it("rejects incomplete detail URLs without calling the API", () => {
    renderDetail("/admin/cost/subject/account/42?month=2026-07");

    expect(
      screen.getByText(
        "This Cost detail URL is incomplete. A valid month, endpoint, subject type, and subject ID are required.",
      ),
    ).toBeInTheDocument();
    expect(mocks.getCostSubjectDetail).not.toHaveBeenCalled();
  });
});
