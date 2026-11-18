/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import { listS3Accounts, type S3AccountSummary } from "../../api/accounts";
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
import { listUserOptions, type UserSummary } from "../../api/users";
import usePaginatedOptions, {
  type PaginatedOptionsQuery,
} from "../../hooks/usePaginatedOptions";
import type { StorageAssociationKind } from "./useAdminStorageAssociationEditorState";

const loadUsers = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<UserSummary>> => listUserOptions(query);

const loadAccounts = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3AccountSummary>> => listS3Accounts(query);

const loadS3Users = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3UserSummary>> => listS3Users(query);

const loadConnections = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3ConnectionSummary>> => listAdminS3Connections(query);

const loadOpenStackClouds = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<OpenStackCloud>> => listAdminOpenStackCloudOptions(query);

type UseAdminGroupAssociationOptions = {
  openStackEnabled: boolean;
  accountsEnabled: boolean;
  s3UsersEnabled: boolean;
  connectionsEnabled: boolean;
  onError: (error: unknown) => void;
};

export default function useAdminGroupAssociationOptions({
  openStackEnabled,
  accountsEnabled,
  s3UsersEnabled,
  connectionsEnabled,
  onError,
}: UseAdminGroupAssociationOptions) {
  const [enabledAssociationKinds, setEnabledAssociationKinds] = useState<
    Record<StorageAssociationKind, boolean>
  >({ accounts: false, s3_users: false, connections: false, openstack: false });
  const users = usePaginatedOptions(loadUsers, { initialPageSize: 10 });
  const accounts = usePaginatedOptions(loadAccounts, {
    enabled: accountsEnabled && enabledAssociationKinds.accounts,
    initialPageSize: 10,
  });
  const s3Users = usePaginatedOptions(loadS3Users, {
    enabled: s3UsersEnabled && enabledAssociationKinds.s3_users,
    initialPageSize: 10,
  });
  const connections = usePaginatedOptions(loadConnections, {
    enabled: connectionsEnabled && enabledAssociationKinds.connections,
    initialPageSize: 10,
  });
  const openStackClouds = usePaginatedOptions(loadOpenStackClouds, {
    enabled: openStackEnabled && enabledAssociationKinds.openstack,
    initialPageSize: 10,
  });
  const { refresh: refreshUsers } = users;
  const { refresh: refreshAccounts } = accounts;
  const { refresh: refreshS3Users } = s3Users;
  const { refresh: refreshConnections } = connections;
  const { refresh: refreshOpenStackClouds } = openStackClouds;

  const ensureAssociationOptions = useCallback((kind: StorageAssociationKind) => {
    if (kind === "accounts") {
      if (!accountsEnabled) return;
      if (!enabledAssociationKinds.accounts) {
        setEnabledAssociationKinds((current) => ({ ...current, accounts: true }));
        return;
      }
      if (!accounts.loading && !accounts.loaded) refreshAccounts();
      return;
    }
    if (kind === "s3_users") {
      if (!s3UsersEnabled) return;
      if (!enabledAssociationKinds.s3_users) {
        setEnabledAssociationKinds((current) => ({ ...current, s3_users: true }));
        return;
      }
      if (!s3Users.loading && !s3Users.loaded) refreshS3Users();
      return;
    }
    if (kind === "connections") {
      if (!connectionsEnabled) return;
      if (!enabledAssociationKinds.connections) {
        setEnabledAssociationKinds((current) => ({ ...current, connections: true }));
        return;
      }
      if (!connections.loading && !connections.loaded) refreshConnections();
      return;
    }
    if (!openStackEnabled) return;
    if (!enabledAssociationKinds.openstack) {
      setEnabledAssociationKinds((current) => ({ ...current, openstack: true }));
      return;
    }
    if (openStackEnabled && !openStackClouds.loading && !openStackClouds.loaded) {
      refreshOpenStackClouds();
    }
  }, [
    accounts.loaded,
    accounts.loading,
    accountsEnabled,
    connections.loaded,
    connections.loading,
    connectionsEnabled,
    enabledAssociationKinds.accounts,
    enabledAssociationKinds.connections,
    enabledAssociationKinds.openstack,
    enabledAssociationKinds.s3_users,
    openStackClouds.loaded,
    openStackClouds.loading,
    openStackEnabled,
    refreshAccounts,
    refreshConnections,
    refreshOpenStackClouds,
    refreshS3Users,
    s3Users.loaded,
    s3Users.loading,
    s3UsersEnabled,
  ]);

  const refresh = useCallback(async () => {
    refreshUsers();
  }, [
    refreshUsers,
  ]);

  const error =
    users.error ??
    (accountsEnabled ? accounts.error : null) ??
    (s3UsersEnabled ? s3Users.error : null) ??
    (connectionsEnabled ? connections.error : null) ??
    (openStackEnabled ? openStackClouds.error : null);
  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  return {
    users: users.items,
    accounts: accounts.items,
    s3Users: s3Users.items,
    connections: connections.items,
    openStackClouds: openStackClouds.items,
    loading:
      users.loading ||
      (accountsEnabled && accounts.loading) ||
      (s3UsersEnabled && s3Users.loading) ||
      (connectionsEnabled && connections.loading) ||
      (openStackEnabled && openStackClouds.loading),
    usersCatalog: users,
    accountsCatalog: accounts,
    s3UsersCatalog: s3Users,
    connectionsCatalog: connections,
    openStackCloudsCatalog: openStackClouds,
    ensureAssociationOptions,
    refresh,
  };
}
