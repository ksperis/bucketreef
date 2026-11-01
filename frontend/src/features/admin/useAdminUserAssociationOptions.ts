/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect } from "react";
import { listMinimalS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalS3Connections, type S3ConnectionSummary } from "../../api/s3ConnectionsAdmin";
import { listMinimalS3Users, type S3UserSummary } from "../../api/s3Users";
import { listAdminOpenStackClouds, type OpenStackCloud } from "../../api/openstack";
import useLazyListLoader, { type LazyListEnsureOptions } from "../../hooks/useLazyListLoader";
import type { StorageAssociationTab } from "./useAdminStorageAssociationEditorState";

export default function useAdminUserAssociationOptions() {
  const accountsLoader = useLazyListLoader<S3AccountSummary>(listMinimalS3Accounts, console.error);
  const s3UsersLoader = useLazyListLoader<S3UserSummary>(listMinimalS3Users, console.error);
  const s3ConnectionsLoader = useLazyListLoader<S3ConnectionSummary>(listMinimalS3Connections, console.error);
  const groupsLoader = useLazyListLoader<UiGroupSummary>(listMinimalGroups, console.error);
  const openStackLoader = useLazyListLoader<OpenStackCloud>(listAdminOpenStackClouds, console.error);

  const { ensure: ensureS3Accounts } = accountsLoader;
  const { ensure: ensureS3Users } = s3UsersLoader;
  const { ensure: ensureS3Connections } = s3ConnectionsLoader;
  const { ensure: ensureOpenStackClouds } = openStackLoader;
  useEffect(() => {
    void ensureS3Accounts();
  }, [ensureS3Accounts]);

  const ensureAssociationOptionsForTab = useCallback(
    async (tab: StorageAssociationTab, options?: LazyListEnsureOptions) => {
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
