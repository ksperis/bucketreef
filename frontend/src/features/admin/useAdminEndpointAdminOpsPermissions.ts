/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";

import {
  getStorageEndpoint,
  type StorageEndpointAdminOpsPermissions,
} from "../../api/storageEndpoints";

type UseAdminEndpointAdminOpsPermissionsOptions = {
  formatError: (error: unknown) => string;
};

export default function useAdminEndpointAdminOpsPermissions({
  formatError,
}: UseAdminEndpointAdminOpsPermissionsOptions) {
  const [permissionsByEndpointId, setPermissionsByEndpointId] = useState<
    Record<number, StorageEndpointAdminOpsPermissions | null>
  >({});
  const [loadingByEndpointId, setLoadingByEndpointId] = useState<Record<number, boolean>>({});
  const [errorByEndpointId, setErrorByEndpointId] = useState<Record<number, string | null>>({});
  const inFlightEndpointIds = useRef(new Set<number>());

  const loadPermissions = useCallback(
    async (endpointId: number) => {
      if (!Number.isFinite(endpointId) || endpointId <= 0) return;
      if (inFlightEndpointIds.current.has(endpointId)) return;

      inFlightEndpointIds.current.add(endpointId);
      setLoadingByEndpointId((previous) => ({ ...previous, [endpointId]: true }));
      try {
        const endpoint = await getStorageEndpoint(endpointId, {
          include_admin_ops_permissions: true,
        });
        setPermissionsByEndpointId((previous) => ({
          ...previous,
          [endpointId]: endpoint.admin_ops_permissions,
        }));
        setErrorByEndpointId((previous) => ({ ...previous, [endpointId]: null }));
      } catch (error) {
        setPermissionsByEndpointId((previous) => ({ ...previous, [endpointId]: null }));
        setErrorByEndpointId((previous) => ({
          ...previous,
          [endpointId]: formatError(error),
        }));
      } finally {
        inFlightEndpointIds.current.delete(endpointId);
        setLoadingByEndpointId((previous) => ({ ...previous, [endpointId]: false }));
      }
    },
    [formatError]
  );

  return {
    permissionsByEndpointId,
    loadingByEndpointId,
    errorByEndpointId,
    loadPermissions,
  };
}
