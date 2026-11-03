import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UsageTile from "../UsageTile";

describe("UsageTile", () => {
  it("renders configured quota lines while keeping the effective ratio in the circular gauge", () => {
    render(
      <UsageTile
        label="Storage"
        used={100}
        quota={300}
        quotaLines={[
          { label: "Bucket quota", value: 500 },
          { label: "Account quota", value: 1000 },
        ]}
        formatter={(value) => `${value ?? 0} B`}
        quotaFormatter={(value) => `${value ?? 0} B`}
        usageRatio={100 / 3}
      />
    );

    expect(screen.getByRole("img", { name: "Usage at 33%" })).toBeInTheDocument();
    expect(screen.getByText("Bucket quota")).toBeInTheDocument();
    expect(screen.getByText("500 B")).toBeInTheDocument();
    expect(screen.getByText("Account quota")).toBeInTheDocument();
    expect(screen.getByText("1000 B")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("keeps the existing unavailable state when no quota is configured", () => {
    render(
      <UsageTile
        label="Storage"
        used={100}
        quota={null}
        quotaLines={[]}
        formatter={(value) => `${value ?? 0} B`}
        emptyHint="No storage quota configured."
      />
    );

    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("No storage quota configured.")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("uses a generic quota line for existing shared callers", () => {
    render(
      <UsageTile
        label="Objects"
        used={25}
        quota={100}
        formatter={(value) => String(value ?? 0)}
      />
    );

    expect(screen.getByText("Quota")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Usage at 25%" })).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("becomes an accessible action only when a click handler is provided", () => {
    const onClick = vi.fn();
    render(
      <UsageTile
        label="Storage"
        used={25}
        quota={100}
        formatter={(value) => String(value ?? 0)}
        onClick={onClick}
        actionLabel="Storage — Usage & Metrics"
      />
    );

    const action = screen.getByRole("button", { name: "Storage — Usage & Metrics" });
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
