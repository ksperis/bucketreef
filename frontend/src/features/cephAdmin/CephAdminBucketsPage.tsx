/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketOpsWorkbench from "../shared/BucketOpsWorkbench";
import { useCephAdminI18n } from "./cephAdminI18n";

export default function CephAdminBucketsPage() {
  const { text: surfaceText } = useCephAdminI18n();
  return (
    <BucketOpsWorkbench
      mode="ceph-admin"
      shell={{
        pageDescription: surfaceText("Cluster-level bucket listing (Admin Ops + S3)."),
        emptyState: {
          title: surfaceText("Select a Ceph endpoint before listing buckets"),
          description: surfaceText("The bucket workbench stays endpoint-scoped. Choose an endpoint to load inventory, filters, and bulk operations."),
          primaryAction: { label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" },
          tone: "warning",
        },
      }}
    />
  );
}
