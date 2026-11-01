/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import { listMinimalS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listAdminOpenStackClouds, type OpenStackCloud } from "../../api/openstack";
import {
  listMinimalS3Connections,
  type S3ConnectionSummary,
} from "../../api/s3ConnectionsAdmin";
import { listMinimalS3Users, type S3UserSummary } from "../../api/s3Users";
import { listMinimalUsers, type UserSummary } from "../../api/users";

type UseAdminGroupAssociationOptions = {
  openStackEnabled: boolean;
  onError: (error: unknown) => void;
};

export default function useAdminGroupAssociationOptions({
  openStackEnabled,
  onError,
}: UseAdminGroupAssociationOptions) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [accounts, setAccounts] = useState<S3AccountSummary[]>([]);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [connections, setConnections] = useState<S3ConnectionSummary[]>([]);
  const [openStackClouds, setOpenStackClouds] = useState<OpenStackCloud[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextUsers, nextAccounts, nextS3Users, nextConnections, nextOpenStackClouds] =
        await Promise.all([
          listMinimalUsers(),
          listMinimalS3Accounts(),
          listMinimalS3Users(),
          listMinimalS3Connections(),
          openStackEnabled ? listAdminOpenStackClouds() : Promise.resolve([]),
        ]);
      setUsers(nextUsers);
      setAccounts(nextAccounts);
      setS3Users(nextS3Users);
      setConnections(nextConnections);
      setOpenStackClouds(nextOpenStackClouds);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [onError, openStackEnabled]);

  return {
    users,
    accounts,
    s3Users,
    connections,
    openStackClouds,
    loading,
    refresh,
  };
}
