/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect } from "react";

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
  onError: (error: unknown) => void;
};

export default function useAdminGroupAssociationOptions({
  openStackEnabled,
  onError,
}: UseAdminGroupAssociationOptions) {
  const users = usePaginatedOptions(loadUsers, { initialPageSize: 10 });
  const accounts = usePaginatedOptions(loadAccounts, { initialPageSize: 10 });
  const s3Users = usePaginatedOptions(loadS3Users, { initialPageSize: 10 });
  const connections = usePaginatedOptions(loadConnections, { initialPageSize: 10 });
  const openStackClouds = usePaginatedOptions(loadOpenStackClouds, {
    enabled: openStackEnabled,
    initialPageSize: 10,
  });
  const { refresh: refreshUsers } = users;
  const { refresh: refreshAccounts } = accounts;
  const { refresh: refreshS3Users } = s3Users;
  const { refresh: refreshConnections } = connections;
  const { refresh: refreshOpenStackClouds } = openStackClouds;

  const refresh = useCallback(async () => {
    refreshUsers();
    refreshAccounts();
    refreshS3Users();
    refreshConnections();
    if (openStackEnabled) refreshOpenStackClouds();
  }, [
    openStackEnabled,
    refreshAccounts,
    refreshConnections,
    refreshOpenStackClouds,
    refreshS3Users,
    refreshUsers,
  ]);

  const error =
    users.error ??
    accounts.error ??
    s3Users.error ??
    connections.error ??
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
      accounts.loading ||
      s3Users.loading ||
      connections.loading ||
      (openStackEnabled && openStackClouds.loading),
    usersCatalog: users,
    accountsCatalog: accounts,
    s3UsersCatalog: s3Users,
    connectionsCatalog: connections,
    openStackCloudsCatalog: openStackClouds,
    refresh,
  };
}
