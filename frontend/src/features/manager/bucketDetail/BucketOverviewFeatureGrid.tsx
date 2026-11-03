/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketDetailTabId } from "./bucketDetailSurface";
import type {
  BucketOverviewFeatureId,
  BucketOverviewSummaryItem,
} from "./bucketOverviewSummary";
import "./bucketOverviewFeatureGrid.css";

const targetTabByFeature: Record<BucketOverviewFeatureId, BucketDetailTabId> = {
  versioning: "properties",
  "object-lock": "properties",
  "server-side-encryption": "properties",
  replication: "data-management",
  "public-access-block": "permissions",
  "bucket-policy": "permissions",
  cors: "permissions",
  "static-website": "properties",
  lifecycle: "data-management",
  "access-logging": "properties",
  notifications: "properties",
};

export function bucketOverviewFeatureTargetTab(id: BucketOverviewFeatureId): BucketDetailTabId {
  return targetTabByFeature[id];
}

export default function BucketOverviewFeatureGrid({
  items,
  onNavigate,
}: {
  items: readonly BucketOverviewSummaryItem[];
  onNavigate: (tab: BucketDetailTabId) => void;
}) {
  return (
    <div className="bucket-overview-feature-grid">
      {items.map((item) => {
        const targetTab = bucketOverviewFeatureTargetTab(item.id);
        return (
          <button
            key={item.id}
            type="button"
            className="bucket-overview-feature-card"
            data-feature-id={item.id}
            data-feature-state={item.state}
            data-target-tab={targetTab}
            onClick={() => onNavigate(targetTab)}
          >
            <span className="bucket-overview-feature-indicator" aria-hidden="true">
              <span className="bucket-overview-feature-indicator-dot" />
            </span>
            <span className="bucket-overview-feature-copy">
              <span className="bucket-overview-feature-label">{item.label}</span>
              <span className="bucket-overview-feature-value">{item.value}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
