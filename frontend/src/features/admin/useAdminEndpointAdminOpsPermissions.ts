/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

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
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

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
        if (!active.current) return;
        setPermissionsByEndpointId((previous) => ({
          ...previous,
          [endpointId]: endpoint.admin_ops_permissions,
        }));
        setErrorByEndpointId((previous) => ({ ...previous, [endpointId]: null }));
      } catch (error) {
        if (!active.current) return;
        setPermissionsByEndpointId((previous) => ({ ...previous, [endpointId]: null }));
        setErrorByEndpointId((previous) => ({
          ...previous,
          [endpointId]: formatError(error),
        }));
      } finally {
        inFlightEndpointIds.current.delete(endpointId);
        if (active.current) {
          setLoadingByEndpointId((previous) => ({ ...previous, [endpointId]: false }));
        }
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
