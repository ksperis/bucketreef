/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import { useCallback } from "react";
import {
  ADMIN_PAGE_CONTRACTS as ADMIN_NAVIGATION_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
  type WorkspacePageContract,
} from "../../navigation/workspacePages";
import { useAdminI18n } from "./adminI18n";

type AdminPageId = keyof typeof ADMIN_NAVIGATION_CONTRACTS;
type GovernedAdminPageId =
  | "accounts"
  | "groups"
  | "rgw-users"
  | "shared-connections"
  | "storage-endpoints"
  | "users";

type AdminPageContract = {
  title: string;
  navigation: WorkspacePageContract;
  governanceArea: "accounts" | "connections" | "endpoints" | "identity";
};

export const ADMIN_PAGE_CONTRACTS: Record<GovernedAdminPageId, AdminPageContract> = {
  accounts: {
    title: ADMIN_NAVIGATION_CONTRACTS.accounts.label,
    navigation: ADMIN_NAVIGATION_CONTRACTS.accounts,
    governanceArea: "accounts",
  },
  groups: {
    title: ADMIN_NAVIGATION_CONTRACTS.groups.label,
    navigation: ADMIN_NAVIGATION_CONTRACTS.groups,
    governanceArea: "identity",
  },
  "rgw-users": {
    title: ADMIN_NAVIGATION_CONTRACTS["rgw-users"].label,
    navigation: ADMIN_NAVIGATION_CONTRACTS["rgw-users"],
    governanceArea: "accounts",
  },
  "shared-connections": {
    title: ADMIN_NAVIGATION_CONTRACTS["shared-connections"].label,
    navigation: ADMIN_NAVIGATION_CONTRACTS["shared-connections"],
    governanceArea: "connections",
  },
  "storage-endpoints": {
    title: ADMIN_NAVIGATION_CONTRACTS["storage-endpoints"].label,
    navigation: ADMIN_NAVIGATION_CONTRACTS["storage-endpoints"],
    governanceArea: "endpoints",
  },
  users: {
    title: ADMIN_NAVIGATION_CONTRACTS.users.label,
    navigation: ADMIN_NAVIGATION_CONTRACTS.users,
    governanceArea: "identity",
  },
};

export function adminPageBreadcrumbs(
  pageId: AdminPageId,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  return buildWorkspacePageBreadcrumbs(
    "admin",
    ADMIN_NAVIGATION_CONTRACTS[pageId],
    ...trailingBreadcrumbs,
  );
}

export function useAdminPageBreadcrumbs() {
  const { text } = useAdminI18n();
  return useCallback(
    (pageId: AdminPageId, ...trailingBreadcrumbs: PageBreadcrumb[]) =>
      adminPageBreadcrumbs(pageId, ...trailingBreadcrumbs).map((breadcrumb, index) =>
        index < 2 ? { ...breadcrumb, label: text(breadcrumb.label) } : breadcrumb,
      ),
    [text],
  );
}
