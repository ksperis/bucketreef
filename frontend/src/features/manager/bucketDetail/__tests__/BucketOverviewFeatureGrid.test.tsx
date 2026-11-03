import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BucketOverviewFeatureGrid, {
  bucketOverviewFeatureTargetTab,
} from "../BucketOverviewFeatureGrid";
import type { BucketOverviewFeatureId, BucketOverviewSummaryItem } from "../bucketOverviewSummary";

const mappings: Array<[BucketOverviewFeatureId, "properties" | "permissions" | "data-management"]> = [
  ["versioning", "properties"],
  ["object-lock", "properties"],
  ["server-side-encryption", "properties"],
  ["static-website", "properties"],
  ["access-logging", "properties"],
  ["notifications", "properties"],
  ["public-access-block", "permissions"],
  ["bucket-policy", "permissions"],
  ["cors", "permissions"],
  ["lifecycle", "data-management"],
  ["replication", "data-management"],
];

describe("BucketOverviewFeatureGrid", () => {
  it("maps every overview feature to its configuration tab", () => {
    for (const [id, target] of mappings) {
      expect(bucketOverviewFeatureTargetTab(id)).toBe(target);
    }
  });

  it("renders semantic feature states and makes the whole card navigable", () => {
    const onNavigate = vi.fn();
    const items: BucketOverviewSummaryItem[] = [
      { id: "bucket-policy", label: "Bucket policy", value: "Configured", state: "active" },
      { id: "public-access-block", label: "Block public access", value: "Not blocked", state: "warning" },
      { id: "cors", label: "CORS", value: "Not configured", state: "inactive" },
      { id: "lifecycle", label: "Lifecycle", value: "Unavailable", state: "unavailable" },
      { id: "replication", label: "Replication", value: "Loading...", state: "loading" },
    ];

    render(<BucketOverviewFeatureGrid items={items} onNavigate={onNavigate} />);

    for (const item of items) {
      const card = screen.getByRole("button", { name: new RegExp(`${item.label}.*${item.value}`) });
      expect(card).toHaveAttribute("data-feature-id", item.id);
      expect(card).toHaveAttribute("data-feature-state", item.state);
    }

    fireEvent.click(screen.getByRole("button", { name: /Bucket policy.*Configured/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("permissions");

    fireEvent.click(screen.getByRole("button", { name: /Lifecycle.*Unavailable/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("data-management");
  });
});
