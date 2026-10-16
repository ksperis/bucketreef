/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import WorkflowPage from "../../components/WorkflowPage";
import {
  CEPH_ADMIN_PAGE_CONTRACTS,
  STORAGE_OPS_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";
import { useSharedI18n } from "./sharedI18n";

type BucketOpsBulkUpdatePageProps = {
  open: boolean;
  mode: "ceph-admin" | "storage-ops";
  onClose: () => void;
  children: ReactNode;
};

export default function BucketOpsBulkUpdatePage({ open, mode, onClose, children }: BucketOpsBulkUpdatePageProps) {
  const { text: surfaceText } = useSharedI18n();
  if (!open) return null;
  const breadcrumbs =
    mode === "ceph-admin"
      ? buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.buckets, {
          label: surfaceText("Configure selected buckets"),
        })
      : buildWorkspacePageBreadcrumbs("storage-ops", STORAGE_OPS_PAGE_CONTRACTS.buckets, {
          label: surfaceText("Configure selected buckets"),
        });

  return (
    <WorkflowPage
      title={surfaceText("Configure selected buckets")}
      description={surfaceText("Choose an S3 API operation, preview every selected bucket and keep the apply progress visible.")}
      breadcrumbs={breadcrumbs}
      onBack={onClose}
      backLabel={surfaceText("Back to bucket selection")}
      contentClassName="min-w-0"
    >
      {children}
    </WorkflowPage>
  );
}
