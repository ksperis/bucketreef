import { useEffect, useMemo, useState } from "react";

import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import type { Bucket } from "../../../api/bucketContracts";
import { fetchManagerContext } from "../../../api/managerContext";
import { fetchManagerStats } from "../../../api/stats";
import {
  resolveBucketUsageLimit,
  type BucketUsageLimit,
  type BucketUsageLimitSource,
} from "./bucketUsageLimit";

type ManagerOwnerUsage = {
  quotaSizeBytes: number | null;
  quotaObjects: number | null;
  usedBytes: number | null;
  usedObjects: number | null;
  source: Exclude<BucketUsageLimitSource, "bucket" | "owner" | null> | null;
};

const EMPTY_MANAGER_OWNER_USAGE: ManagerOwnerUsage = {
  quotaSizeBytes: null,
  quotaObjects: null,
  usedBytes: null,
  usedObjects: null,
  source: null,
};

type UseBucketUsageLimitsOptions = {
  bucket: Bucket | null;
  cephAdmin: boolean;
  browserScope: boolean;
  managerContextId: S3ExecutionContextSelector;
  managerEnabled: boolean;
};

export type BucketUsageLimits = {
  storage: BucketUsageLimit;
  objects: BucketUsageLimit;
  ownerSource: Exclude<BucketUsageLimitSource, "bucket" | null> | null;
};

export function useBucketUsageLimits({
  bucket,
  cephAdmin,
  browserScope,
  managerContextId,
  managerEnabled,
}: UseBucketUsageLimitsOptions): BucketUsageLimits {
  const [managerOwnerUsage, setManagerOwnerUsage] = useState<ManagerOwnerUsage>(
    EMPTY_MANAGER_OWNER_USAGE,
  );

  useEffect(() => {
    setManagerOwnerUsage(EMPTY_MANAGER_OWNER_USAGE);
    if (cephAdmin || browserScope || !managerEnabled) return;

    let cancelled = false;

    fetchManagerContext(managerContextId, { includeLimits: true })
      .then(async (managerContext) => {
        const quotaSizeGb = managerContext.quota_max_size_gb;
        const quotaSizeBytes = quotaSizeGb != null && quotaSizeGb > 0
          ? quotaSizeGb * 1024 ** 3
          : null;
        const quotaObjects = managerContext.quota_max_objects != null && managerContext.quota_max_objects > 0
          ? managerContext.quota_max_objects
          : null;
        const source = managerContext.access_mode === "s3_user"
          ? "user" as const
          : managerContext.context_kind === "account"
            ? "account" as const
            : null;

        if (quotaSizeBytes === null && quotaObjects === null) {
          if (!cancelled) {
            setManagerOwnerUsage({
              ...EMPTY_MANAGER_OWNER_USAGE,
              source,
            });
          }
          return;
        }

        try {
          const stats = await fetchManagerStats(managerContextId);
          if (!cancelled) {
            setManagerOwnerUsage({
              quotaSizeBytes,
              quotaObjects,
              usedBytes: stats.total_bytes,
              usedObjects: stats.total_objects,
              source,
            });
          }
        } catch {
          if (!cancelled) {
            setManagerOwnerUsage({
              quotaSizeBytes,
              quotaObjects,
              usedBytes: null,
              usedObjects: null,
              source,
            });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setManagerOwnerUsage(EMPTY_MANAGER_OWNER_USAGE);
      });

    return () => {
      cancelled = true;
    };
  }, [browserScope, cephAdmin, managerContextId, managerEnabled]);

  return useMemo(() => {
    const ownerSource = cephAdmin ? "owner" as const : managerOwnerUsage.source;
    const ownerUsedBytes = cephAdmin
      ? bucket?.owner_used_bytes ?? null
      : managerOwnerUsage.usedBytes;
    const ownerUsedObjects = cephAdmin
      ? bucket?.owner_object_count ?? null
      : managerOwnerUsage.usedObjects;
    const ownerQuotaSizeBytes = cephAdmin
      ? bucket?.owner_quota_max_size_bytes ?? null
      : managerOwnerUsage.quotaSizeBytes;
    const ownerQuotaObjects = cephAdmin
      ? bucket?.owner_quota_max_objects ?? null
      : managerOwnerUsage.quotaObjects;

    return {
      storage: resolveBucketUsageLimit({
        used: bucket?.used_bytes ?? null,
        bucketQuota: bucket?.quota_max_size_bytes ?? null,
        ownerUsed: ownerUsedBytes,
        ownerQuota: ownerQuotaSizeBytes,
        ownerSource,
      }),
      objects: resolveBucketUsageLimit({
        used: bucket?.object_count ?? null,
        bucketQuota: bucket?.quota_max_objects ?? null,
        ownerUsed: ownerUsedObjects,
        ownerQuota: ownerQuotaObjects,
        ownerSource,
      }),
      ownerSource,
    };
  }, [bucket, cephAdmin, managerOwnerUsage]);
}
