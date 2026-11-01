/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import { listMinimalGroups } from "../../api/groups";
import { listMinimalUsers } from "../../api/users";
import useLazyListLoader from "../../hooks/useLazyListLoader";

export default function useAdminPrincipalCatalogs() {
  const usersLoader = useLazyListLoader(listMinimalUsers);
  const groupsLoader = useLazyListLoader(listMinimalGroups);
  const { ensure: ensureUsers } = usersLoader;
  const { ensure: ensureGroups } = groupsLoader;
  const loadUsers = useCallback(
    () => ensureUsers({ retryOnError: true }),
    [ensureUsers],
  );
  const loadGroups = useCallback(
    () => ensureGroups({ retryOnError: true }),
    [ensureGroups],
  );

  return {
    users: usersLoader.items,
    groups: groupsLoader.items,
    groupsLoading: groupsLoader.loading,
    loadUsers,
    loadGroups,
  };
}
