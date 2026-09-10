import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkspaceDashboardKpiRow,
  type WorkspaceDashboardMetric,
  WorkspaceDashboardMetricTrendLine,
} from "../WorkspaceDashboardKit";

describe("WorkspaceDashboardMetricTrendLine", () => {
  it("allows long localized KPI trend qualifiers to wrap inside the card", () => {
    const { container } = render(
      <WorkspaceDashboardMetricTrendLine
        trend={{
          label: "44 MB par rapport à la semaine dernière",
          valueLabel: "44 MB",
          qualifierLabel: " par rapport à la semaine dernière",
          tone: "negative",
        }}
      />
    );

    const line = container.querySelector("p");
    const label = line?.querySelector("span.min-w-0");

    expect(line).toHaveTextContent("44 MB par rapport à la semaine dernière");
    expect(line).toHaveClass("min-w-0", "items-start");
    expect(line).not.toHaveClass("whitespace-nowrap");
    expect(label).toHaveClass("whitespace-normal", "break-words");
  });
});

describe("WorkspaceDashboardKpiRow", () => {
  it("supports a balanced five-column dashboard row at the shared desktop breakpoint", () => {
    const { container } = render(
      <WorkspaceDashboardKpiRow metrics={[]} columns={5} />
    );

    expect(container.firstElementChild).toHaveClass("md:grid-cols-2", "xl:grid-cols-5");
    expect(container.firstElementChild).not.toHaveClass("2xl:grid-cols-5");
  });
});

describe("dashboard presentation compatibility", () => {
  it.each([undefined, "compact"] as const)("preserves metric contents, meters and unavailable link restrictions (%s)", (presentation) => {
    const metric: WorkspaceDashboardMetric = { label: "Storage", value: "12 GB", detail: "of 40 GB", progress: 30, tone: "blue", icon: <span />, to: "/manager/metrics", trend: { label: "2 GB vs last month", tone: "positive" } };
    render(<MemoryRouter><WorkspaceDashboardKpiRow presentation={presentation} metrics={[metric, { ...metric, label: "Unavailable", value: "", unavailableReason: "No access" }]} /></MemoryRouter>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/manager/metrics");
    expect(screen.getByRole("link")).toHaveTextContent("12 GBof 40 GB");
    expect(screen.getByRole("link")).toHaveTextContent("2 GB vs last month");
    expect(screen.getByRole("meter", { name: "Storage quota usage" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByText("Unavailable").closest("a")).toBeNull();
  });
});
