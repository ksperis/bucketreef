/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import {
  STORAGE_OPS_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";

type StorageOpsPageId = keyof typeof STORAGE_OPS_PAGE_CONTRACTS;

export function storageOpsPageBreadcrumbs(
  pageId: StorageOpsPageId,
  pageLabel: string = STORAGE_OPS_PAGE_CONTRACTS[pageId].label,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  const page = { ...STORAGE_OPS_PAGE_CONTRACTS[pageId], label: pageLabel };
  return buildWorkspacePageBreadcrumbs(
    "storage-ops",
    page,
    ...trailingBreadcrumbs,
  );
}
