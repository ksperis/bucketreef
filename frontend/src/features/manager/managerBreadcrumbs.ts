/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import {
  MANAGER_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";

type ManagerPageId = keyof typeof MANAGER_PAGE_CONTRACTS;
type ManagerBreadcrumbText = (message: string) => string;

export function managerPageBreadcrumbs(
  text: ManagerBreadcrumbText,
  pageId: ManagerPageId,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  const page = MANAGER_PAGE_CONTRACTS[pageId];
  return buildWorkspacePageBreadcrumbs(
    "manager",
    { ...page, label: text(page.label) },
    ...trailingBreadcrumbs,
  );
}
