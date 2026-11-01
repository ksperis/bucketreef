/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import {
  listS3Accounts,
  type S3AccountSummary,
} from "../../api/accounts";
import { listGroupOptions, type UiGroupSummary } from "../../api/groups";
import {
  listAdminOpenStackCloudOptions,
  type OpenStackCloud,
} from "../../api/openstack";
import {
  listAdminS3Connections,
  type S3ConnectionSummary,
} from "../../api/s3ConnectionsAdmin";
import { listS3Users, type S3UserSummary } from "../../api/s3Users";
import type { PaginatedResponse } from "../../api/types";
import usePaginatedOptions, {
  type PaginatedOptionsQuery,
} from "../../hooks/usePaginatedOptions";
import type { StorageAssociationTab } from "./useAdminStorageAssociationEditorState";

type EnsureOptions = { retryOnError?: boolean };

const loadAccounts = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3AccountSummary>> => listS3Accounts(query);

const loadS3Users = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3UserSummary>> => listS3Users(query);

const loadConnections = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3ConnectionSummary>> => listAdminS3Connections(query);

const loadGroups = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<UiGroupSummary>> => listGroupOptions(query);

const loadOpenStackClouds = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<OpenStackCloud>> => listAdminOpenStackCloudOptions(query);

export default function useAdminUserAssociationOptions() {
  const accounts = usePaginatedOptions(loadAccounts, { initialPageSize: 10 });
  const s3Users = usePaginatedOptions(loadS3Users, { initialPageSize: 10 });
  const s3Connections = usePaginatedOptions(loadConnections, { initialPageSize: 10 });
  const groups = usePaginatedOptions(loadGroups, { initialPageSize: 10 });
  const openStackClouds = usePaginatedOptions(loadOpenStackClouds, { initialPageSize: 10 });

  const ensureAccounts = useCallback((options?: EnsureOptions) => {
    if (accounts.loading || accounts.loaded) return;
    if (accounts.error && !options?.retryOnError) return;
    accounts.refresh();
  }, [accounts.error, accounts.loaded, accounts.loading, accounts.refresh]);

  const ensureS3Users = useCallback((options?: EnsureOptions) => {
    if (s3Users.loading || s3Users.loaded) return;
    if (s3Users.error && !options?.retryOnError) return;
    s3Users.refresh();
  }, [s3Users.error, s3Users.loaded, s3Users.loading, s3Users.refresh]);

  const ensureS3Connections = useCallback((options?: EnsureOptions) => {
    if (s3Connections.loading || s3Connections.loaded) return;
    if (s3Connections.error && !options?.retryOnError) return;
    s3Connections.refresh();
  }, [s3Connections.error, s3Connections.loaded, s3Connections.loading, s3Connections.refresh]);

  const ensureGroups = useCallback((options?: EnsureOptions) => {
    if (groups.loading || groups.loaded) return;
    if (groups.error && !options?.retryOnError) return;
    groups.refresh();
  }, [groups.error, groups.loaded, groups.loading, groups.refresh]);

  const ensureOpenStackClouds = useCallback((options?: EnsureOptions) => {
    if (openStackClouds.loading || openStackClouds.loaded) return;
    if (openStackClouds.error && !options?.retryOnError) return;
    openStackClouds.refresh();
  }, [openStackClouds.error, openStackClouds.loaded, openStackClouds.loading, openStackClouds.refresh]);

  const ensureAssociationOptionsForTab = useCallback(
    async (
      tab: StorageAssociationTab,
      options?: EnsureOptions,
    ) => {
      if (tab === "accounts") ensureAccounts(options);
      else if (tab === "s3_users") ensureS3Users(options);
      else if (tab === "openstack") ensureOpenStackClouds(options);
      else ensureS3Connections(options);
    },
    [
      ensureAccounts,
      ensureOpenStackClouds,
      ensureS3Connections,
      ensureS3Users,
    ],
  );

  const resetSearches = useCallback(() => {
    accounts.setSearch("");
    s3Users.setSearch("");
    s3Connections.setSearch("");
    groups.setSearch("");
    openStackClouds.setSearch("");
  }, [
    accounts.setSearch,
    groups.setSearch,
    openStackClouds.setSearch,
    s3Connections.setSearch,
    s3Users.setSearch,
  ]);

  return {
    accounts: accounts.items,
    s3AccountsLoaded: accounts.loaded,
    s3AccountsLoading: accounts.loading,
    refreshS3Accounts: accounts.refresh,
    ensureS3Accounts: ensureAccounts,
    s3AccountsCatalog: accounts,
    s3Users: s3Users.items,
    s3UsersLoading: s3Users.loading,
    s3UsersCatalog: s3Users,
    s3Connections: s3Connections.items,
    s3ConnectionsLoading: s3Connections.loading,
    s3ConnectionsCatalog: s3Connections,
    groups: groups.items,
    groupsLoaded: groups.loaded,
    groupsLoading: groups.loading,
    ensureGroups,
    groupsCatalog: groups,
    openStackClouds: openStackClouds.items,
    openStackCloudsLoading: openStackClouds.loading,
    openStackCloudsCatalog: openStackClouds,
    ensureAssociationOptionsForTab,
    resetAssociationOptionSearches: resetSearches,
  };
}
