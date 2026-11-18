/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useState } from "react";
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
import type { StorageAssociationKind } from "./useAdminStorageAssociationEditorState";

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

export default function useAdminUserAssociationOptions(
  openStackEnabled = true,
  accountsEnabled = true,
  s3UsersEnabled = true,
  s3ConnectionsEnabled = true,
) {
  const [enabledAssociationKinds, setEnabledAssociationKinds] = useState<
    Record<StorageAssociationKind, boolean>
  >({ accounts: false, s3_users: false, connections: false, openstack: false });
  const accounts = usePaginatedOptions(loadAccounts, {
    enabled: accountsEnabled && enabledAssociationKinds.accounts,
    initialPageSize: 10,
  });
  const s3Users = usePaginatedOptions(loadS3Users, {
    enabled: s3UsersEnabled && enabledAssociationKinds.s3_users,
    initialPageSize: 10,
  });
  const s3Connections = usePaginatedOptions(loadConnections, {
    enabled: s3ConnectionsEnabled && enabledAssociationKinds.connections,
    initialPageSize: 10,
  });
  const groups = usePaginatedOptions(loadGroups, { initialPageSize: 10 });
  const openStackClouds = usePaginatedOptions(loadOpenStackClouds, {
    enabled: openStackEnabled && enabledAssociationKinds.openstack,
    initialPageSize: 10,
  });
  const {
    error: accountsError,
    loaded: accountsLoaded,
    loading: accountsLoading,
    refresh: refreshAccounts,
    setSearch: setAccountsSearch,
  } = accounts;
  const {
    error: s3UsersError,
    loaded: s3UsersLoaded,
    loading: s3UsersLoading,
    refresh: refreshS3Users,
    setSearch: setS3UsersSearch,
  } = s3Users;
  const {
    error: s3ConnectionsError,
    loaded: s3ConnectionsLoaded,
    loading: s3ConnectionsLoading,
    refresh: refreshS3Connections,
    setSearch: setS3ConnectionsSearch,
  } = s3Connections;
  const {
    error: groupsError,
    loaded: groupsLoaded,
    loading: groupsLoading,
    refresh: refreshGroups,
    setSearch: setGroupsSearch,
  } = groups;
  const {
    error: openStackCloudsError,
    loaded: openStackCloudsLoaded,
    loading: openStackCloudsLoading,
    refresh: refreshOpenStackClouds,
    setSearch: setOpenStackCloudsSearch,
  } = openStackClouds;

  const ensureAccounts = useCallback((options?: EnsureOptions) => {
    if (!accountsEnabled) return;
    if (!enabledAssociationKinds.accounts) {
      setEnabledAssociationKinds((current) => ({ ...current, accounts: true }));
      return;
    }
    if (accountsLoading || accountsLoaded) return;
    if (accountsError && !options?.retryOnError) return;
    refreshAccounts();
  }, [accountsEnabled, accountsError, accountsLoaded, accountsLoading, enabledAssociationKinds.accounts, refreshAccounts]);

  const ensureS3Users = useCallback((options?: EnsureOptions) => {
    if (!s3UsersEnabled) return;
    if (!enabledAssociationKinds.s3_users) {
      setEnabledAssociationKinds((current) => ({ ...current, s3_users: true }));
      return;
    }
    if (s3UsersLoading || s3UsersLoaded) return;
    if (s3UsersError && !options?.retryOnError) return;
    refreshS3Users();
  }, [enabledAssociationKinds.s3_users, refreshS3Users, s3UsersEnabled, s3UsersError, s3UsersLoaded, s3UsersLoading]);

  const ensureS3Connections = useCallback((options?: EnsureOptions) => {
    if (!s3ConnectionsEnabled) return;
    if (!enabledAssociationKinds.connections) {
      setEnabledAssociationKinds((current) => ({ ...current, connections: true }));
      return;
    }
    if (s3ConnectionsLoading || s3ConnectionsLoaded) return;
    if (s3ConnectionsError && !options?.retryOnError) return;
    refreshS3Connections();
  }, [enabledAssociationKinds.connections, refreshS3Connections, s3ConnectionsEnabled, s3ConnectionsError, s3ConnectionsLoaded, s3ConnectionsLoading]);

  const ensureGroups = useCallback((options?: EnsureOptions) => {
    if (groupsLoading || groupsLoaded) return;
    if (groupsError && !options?.retryOnError) return;
    refreshGroups();
  }, [groupsError, groupsLoaded, groupsLoading, refreshGroups]);

  const ensureOpenStackClouds = useCallback((options?: EnsureOptions) => {
    if (!openStackEnabled) return;
    if (!enabledAssociationKinds.openstack) {
      setEnabledAssociationKinds((current) => ({ ...current, openstack: true }));
      return;
    }
    if (openStackCloudsLoading || openStackCloudsLoaded) return;
    if (openStackCloudsError && !options?.retryOnError) return;
    refreshOpenStackClouds();
  }, [enabledAssociationKinds.openstack, openStackEnabled, openStackCloudsError, openStackCloudsLoaded, openStackCloudsLoading, refreshOpenStackClouds]);

  const ensureAssociationOptions = useCallback(
    async (
      kind: StorageAssociationKind,
      options?: EnsureOptions,
    ) => {
      if (kind === "accounts") ensureAccounts(options);
      else if (kind === "s3_users") ensureS3Users(options);
      else if (kind === "openstack") ensureOpenStackClouds(options);
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
    setAccountsSearch("");
    setS3UsersSearch("");
    setS3ConnectionsSearch("");
    setGroupsSearch("");
    setOpenStackCloudsSearch("");
  }, [
    setAccountsSearch,
    setGroupsSearch,
    setOpenStackCloudsSearch,
    setS3ConnectionsSearch,
    setS3UsersSearch,
  ]);

  return {
    accounts: accounts.items,
    s3AccountsLoaded: accountsLoaded,
    s3AccountsLoading: accountsLoading,
    refreshS3Accounts: refreshAccounts,
    ensureS3Accounts: ensureAccounts,
    s3AccountsCatalog: accounts,
    s3Users: s3Users.items,
    s3UsersLoading,
    s3UsersCatalog: s3Users,
    s3Connections: s3Connections.items,
    s3ConnectionsLoading,
    s3ConnectionsCatalog: s3Connections,
    groups: groups.items,
    groupsLoaded,
    groupsLoading,
    ensureGroups,
    groupsCatalog: groups,
    openStackClouds: openStackClouds.items,
    openStackCloudsLoading,
    openStackCloudsCatalog: openStackClouds,
    ensureAssociationOptions,
    resetAssociationOptionSearches: resetSearches,
  };
}
