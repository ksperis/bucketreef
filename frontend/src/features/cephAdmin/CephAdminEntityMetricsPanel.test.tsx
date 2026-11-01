import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CephAdminEntityMetricsPanel from "./CephAdminEntityMetricsPanel";

describe("CephAdminEntityMetricsPanel", () => {
  it("renders shared entity metrics and bucket usage", () => {
    render(
      <CephAdminEntityMetricsPanel
        error={null}
        loading={false}
        metrics={{
          total_bytes: 1024,
          total_objects: 4,
          bucket_count: 1,
          bucket_usage: [
            { name: "archive", used_bytes: 1024, object_count: 4 },
          ],
          generated_at: "2026-11-01T12:00:00Z",
        }}
        quota={{ enabled: true, max_size_bytes: 2048, max_objects: 8 }}
      />,
    );

    expect(screen.getByText("Top buckets by usage")).toBeInTheDocument();
    expect(screen.getByText("1 bucket")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
  });
});
