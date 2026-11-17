import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "../../components/language";
import { setSessionUserCache } from "../../utils/workspaces";
import TrafficAnalytics from "./TrafficAnalytics";

const fetchManagerTrafficMock = vi.fn();

vi.mock("../../api/stats", async () => {
  const actual = await vi.importActual<typeof import("../../api/stats")>("../../api/stats");
  return {
    ...actual,
    fetchManagerTraffic: (...args: unknown[]) => fetchManagerTrafficMock(...args),
  };
});

vi.mock("../../components/TrafficBytesChart", () => ({
  default: ({ ingressLabel, egressLabel }: { ingressLabel?: string; egressLabel?: string }) => (
    <div data-testid="traffic-bytes-chart" data-ingress-label={ingressLabel} data-egress-label={egressLabel} />
  ),
}));

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Bar: Passthrough,
    BarChart: Passthrough,
    CartesianGrid: () => null,
    Cell: () => null,
    Pie: Passthrough,
    PieChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

describe("TrafficAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUserCache({ role: "ui_admin", authType: "password", ui_language: "fr" });
    fetchManagerTrafficMock.mockResolvedValue({
      window: "week",
      start: "2026-11-10T00:00:00Z",
      end: "2026-11-17T00:00:00Z",
      resolution: "day",
      bucket_filter: "demo-bucket",
      data_points: 1,
      series: [{ timestamp: "2026-11-16T00:00:00Z", bytes_in: 1024, bytes_out: 2048, ops: 33, success_ops: 33 }],
      totals: { bytes_in: 1024, bytes_out: 2048, ops: 33, success_ops: 33, success_rate: 1 },
      bucket_rankings: [],
      user_rankings: [],
      request_breakdown: [
        { group: "read", bytes_in: 1024, bytes_out: 2048, ops: 33 },
        { group: "list", bytes_in: 0, bytes_out: 64, ops: 1 },
      ],
      category_breakdown: [],
    });
  });

  it("localizes traffic legend labels and request operation counts for French Manager", async () => {
    render(
      <LanguageProvider>
        <TrafficAnalytics contextId="acc-1" bucketName="demo-bucket" />
      </LanguageProvider>,
    );

    const chart = await screen.findByTestId("traffic-bytes-chart");
    await waitFor(() => expect(fetchManagerTrafficMock).toHaveBeenCalled());
    expect(chart).toHaveAttribute("data-ingress-label", "Trafic entrant");
    expect(chart).toHaveAttribute("data-egress-label", "Trafic de sortie");
    expect(screen.getByText("33 opérations")).toBeVisible();
    expect(screen.getByText("1 opération")).toBeVisible();
  });
});
