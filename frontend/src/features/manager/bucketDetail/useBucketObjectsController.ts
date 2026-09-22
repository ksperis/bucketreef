/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import { listCephAdminBucketObjects } from "../../../api/cephAdminBucketDetails";
import { listObjects, type S3Object } from "../../../api/objects";
import { extractApiError } from "../../../utils/apiError";

type UseBucketObjectsControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

function parentObjectPrefix(prefix: string): string {
  if (!prefix) return "";
  const withoutTrailingSlash = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const separatorIndex = withoutTrailingSlash.lastIndexOf("/");
  return separatorIndex < 0 ? "" : withoutTrailingSlash.slice(0, separatorIndex + 1);
}

export function useBucketObjectsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketObjectsControllerOptions) {
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPrefix, setCurrentPrefix] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setCurrentPrefix("");
    setObjects([]);
    setPrefixes([]);
    setError(null);
    setLoading(false);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const load = useCallback(
    async (prefix: string) => {
      const requestId = ++requestIdRef.current;
      if (!bucketName || !enabled || (cephAdmin && !endpointId)) {
        setObjects([]);
        setPrefixes([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setObjects([]);
      setPrefixes([]);
      try {
        let data;
        if (cephAdmin) {
          if (!endpointId) return;
          data = await listCephAdminBucketObjects(
            endpointId,
            bucketName,
            prefix,
          );
        } else {
          data = await listObjects(accountId, bucketName, prefix);
        }
        if (requestId !== requestIdRef.current) return;
        setObjects(
          data.objects.map((object) => ({
            ...object,
            last_modified: object.last_modified ?? undefined,
          })),
        );
        setPrefixes(data.prefixes);
      } catch (loadFailure) {
        if (requestId !== requestIdRef.current) return;
        setObjects([]);
        setPrefixes([]);
        setError(extractApiError(loadFailure, "Unable to list objects."));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [accountId, bucketName, cephAdmin, enabled, endpointId],
  );

  const refresh = useCallback(
    () => load(currentPrefix),
    [currentPrefix, load],
  );

  const parentPrefix = useMemo(() => {
    return parentObjectPrefix(currentPrefix);
  }, [currentPrefix]);

  const rows = useMemo(() => {
    const normalizedPrefix =
      currentPrefix.endsWith("/") || currentPrefix === ""
        ? currentPrefix
        : `${currentPrefix}/`;
    return [
      ...prefixes.map((prefix) => ({
        type: "prefix" as const,
        key: prefix,
        name: prefix.slice(normalizedPrefix.length) || prefix,
      })),
      ...objects.map((object) => ({
        type: "object" as const,
        key: object.key,
        name: object.key.slice(normalizedPrefix.length),
        object,
      })),
    ];
  }, [currentPrefix, objects, prefixes]);

  return {
    currentPrefix,
    error,
    loading,
    openPrefix: setCurrentPrefix,
    parentPrefix,
    prefixes,
    refresh,
    rows,
  };
}
