/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalUsers, type UserSummary } from "../../api/users";

export default function useAdminPrincipalCatalogs() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const usersLoaded = useRef(false);
  const groupsLoaded = useRef(false);
  const usersInFlight = useRef(false);
  const groupsInFlight = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const loadUsers = useCallback(async () => {
    if (usersLoaded.current || usersInFlight.current) return;
    usersInFlight.current = true;
    try {
      const data = await listMinimalUsers();
      if (!active.current) return;
      setUsers(data);
      usersLoaded.current = true;
    } catch {
      if (active.current) setUsers([]);
    } finally {
      usersInFlight.current = false;
    }
  }, []);

  const loadGroups = useCallback(async () => {
    if (groupsLoaded.current || groupsInFlight.current) return;
    groupsInFlight.current = true;
    setGroupsLoading(true);
    try {
      const data = await listMinimalGroups();
      if (!active.current) return;
      setGroups(data);
      groupsLoaded.current = true;
    } catch {
      if (active.current) setGroups([]);
    } finally {
      groupsInFlight.current = false;
      if (active.current) setGroupsLoading(false);
    }
  }, []);

  return {
    users,
    groups,
    groupsLoading,
    loadUsers,
    loadGroups,
  };
}
