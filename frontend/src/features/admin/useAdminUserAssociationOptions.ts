/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listMinimalS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalS3Connections, type S3ConnectionSummary } from "../../api/s3ConnectionsAdmin";
import { listMinimalS3Users, type S3UserSummary } from "../../api/s3Users";
import { listAdminOpenStackClouds, type OpenStackCloud } from "../../api/openstack";
import type { AssociationTab } from "./UserAssociationsTabs";

type LoadState = "idle" | "loading" | "loaded" | "error";
type EnsureOptions = { retryOnError?: boolean };

function useLazyOptionsLoader<T>(loader: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadStateRef = useRef<LoadState>("idle");

  const refresh = useCallback(async () => {
    if (loadStateRef.current === "loading") return;
    loadStateRef.current = "loading";
    setLoading(true);
    try {
      const data = await loader();
      setItems(data);
      setLoaded(true);
      loadStateRef.current = "loaded";
    } catch (error) {
      loadStateRef.current = "error";
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [loader]);

  const ensure = useCallback(async (options?: EnsureOptions) => {
    const loadState = loadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await refresh();
  }, [refresh]);

  return { items, loading, loaded, refresh, ensure };
}

export default function useAdminUserAssociationOptions() {
  const accountsLoader = useLazyOptionsLoader<S3AccountSummary>(listMinimalS3Accounts);
  const s3UsersLoader = useLazyOptionsLoader<S3UserSummary>(listMinimalS3Users);
  const s3ConnectionsLoader = useLazyOptionsLoader<S3ConnectionSummary>(listMinimalS3Connections);
  const groupsLoader = useLazyOptionsLoader<UiGroupSummary>(listMinimalGroups);
  const openStackLoader = useLazyOptionsLoader<OpenStackCloud>(listAdminOpenStackClouds);

  const { ensure: ensureS3Accounts } = accountsLoader;
  const { ensure: ensureS3Users } = s3UsersLoader;
  const { ensure: ensureS3Connections } = s3ConnectionsLoader;
  const { ensure: ensureOpenStackClouds } = openStackLoader;
  useEffect(() => {
    void ensureS3Accounts();
  }, [ensureS3Accounts]);

  const ensureAssociationOptionsForTab = useCallback(
    async (tab: AssociationTab, options?: EnsureOptions) => {
      if (tab === "accounts") {
        await ensureS3Accounts(options);
        return;
      }
      if (tab === "s3_users") {
        await ensureS3Users(options);
        return;
      }
      if (tab === "openstack") {
        await ensureOpenStackClouds(options);
        return;
      }
      await ensureS3Connections(options);
    },
    [ensureOpenStackClouds, ensureS3Accounts, ensureS3Connections, ensureS3Users],
  );

  return {
    accounts: accountsLoader.items,
    s3AccountsLoaded: accountsLoader.loaded,
    s3AccountsLoading: accountsLoader.loading,
    refreshS3Accounts: accountsLoader.refresh,
    ensureS3Accounts: accountsLoader.ensure,
    s3Users: s3UsersLoader.items,
    s3UsersLoading: s3UsersLoader.loading,
    s3Connections: s3ConnectionsLoader.items,
    s3ConnectionsLoading: s3ConnectionsLoader.loading,
    groups: groupsLoader.items,
    groupsLoaded: groupsLoader.loaded,
    groupsLoading: groupsLoader.loading,
    ensureGroups: groupsLoader.ensure,
    openStackClouds: openStackLoader.items,
    openStackCloudsLoading: openStackLoader.loading,
    ensureAssociationOptionsForTab,
  };
}
