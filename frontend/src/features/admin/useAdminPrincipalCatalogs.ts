/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import { listGroupOptions } from "../../api/groups";
import { listUserOptions } from "../../api/users";
import usePaginatedOptions from "../../hooks/usePaginatedOptions";

export default function useAdminPrincipalCatalogs() {
  const usersLoader = usePaginatedOptions(listUserOptions);
  const groupsLoader = usePaginatedOptions(listGroupOptions);
  const loadUsers = useCallback(
    async () => usersLoader.refresh(),
    [usersLoader.refresh],
  );
  const loadGroups = useCallback(
    async () => groupsLoader.refresh(),
    [groupsLoader.refresh],
  );

  return {
    users: usersLoader.items,
    groups: groupsLoader.items,
    groupsLoading: groupsLoader.loading,
    usersLoading: usersLoader.loading,
    loadUsers,
    loadGroups,
    usersPagination: {
      page: usersLoader.page,
      pageSize: usersLoader.pageSize,
      total: usersLoader.total,
      setPage: usersLoader.setPage,
      setPageSize: usersLoader.setPageSize,
      search: usersLoader.search,
      setSearch: usersLoader.setSearch,
    },
    groupsPagination: {
      page: groupsLoader.page,
      pageSize: groupsLoader.pageSize,
      total: groupsLoader.total,
      setPage: groupsLoader.setPage,
      setPageSize: groupsLoader.setPageSize,
      search: groupsLoader.search,
      setSearch: groupsLoader.setSearch,
    },
  };
}
