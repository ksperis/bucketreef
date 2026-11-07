/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import type { BucketOpsApi } from "./bucketOpsApi";
import { encodeCephAdminBucketRef } from "./bucketOpsPresentation";
import { serializeAdvancedFilterRules } from "./advancedFilterShared";
import { useBucketFeatureTooltips } from "./useBucketFeatureTooltips";

type OwnerTooltipState =
  | { status: "loading" }
  | { status: "ready"; ownerName: string | null }
  | { status: "error"; message: string };

type BucketOpsTooltipApi = Pick<
  BucketOpsApi,
  | "getBucketCors"
  | "getBucketEncryption"
  | "getBucketLogging"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketWebsite"
  | "listBuckets"
>;

type UseBucketOpsTooltipsInput = BucketOpsTooltipApi & {
  extractError: (error: unknown) => string;
  isStorageOps: boolean;
  missingScopeError: string;
  selectedScopeId: number | null | undefined;
};

export function useBucketOpsTooltips({
  extractError,
  getBucketCors,
  getBucketEncryption,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketWebsite,
  isStorageOps,
  listBuckets,
  missingScopeError,
  selectedScopeId,
}: UseBucketOpsTooltipsInput) {
  const [activeOwnerTooltipKey, setActiveOwnerTooltipKey] = useState<string | null>(null);
  const [ownerTooltipState, setOwnerTooltipState] = useState<Record<string, OwnerTooltipState>>({});
  const ownerTooltipInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const ownerNameCacheRef = useRef<Record<string, string | null>>({});
  const generationRef = useRef(0);

  const bucketTooltipCacheKey = useCallback(
    (bucket: CephAdminBucket) =>
      `${selectedScopeId ?? "missing"}:${bucket.tenant ?? ""}:${bucket.name}`,
    [selectedScopeId],
  );
  const bucketRequestName = useCallback(
    (bucket: CephAdminBucket) =>
      isStorageOps
        ? bucket.name
        : encodeCephAdminBucketRef(bucket.name, bucket.tenant),
    [isStorageOps],
  );
  const ownerTooltipCacheKey = useCallback(
    (bucket: CephAdminBucket) =>
      `${bucketTooltipCacheKey(bucket)}:${bucket.owner ?? ""}:owner`,
    [bucketTooltipCacheKey],
  );
  const {
    activeFeatureTooltipKey,
    featureTooltipCacheKey,
    featureTooltipState,
    loadFeatureTooltip,
    resetFeatureTooltipState,
    setActiveFeatureTooltipKey,
  } = useBucketFeatureTooltips<CephAdminBucket>({
    bucketCacheKey: bucketTooltipCacheKey,
    enabled: Boolean(selectedScopeId),
    extractError,
    getBucketCors: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketCors(selectedScopeId, bucketRequestName(bucket));
    },
    getBucketEncryption: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketEncryption(selectedScopeId, bucketRequestName(bucket));
    },
    getBucketLogging: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketLogging(selectedScopeId, bucketRequestName(bucket));
    },
    getBucketNotifications: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketNotifications(selectedScopeId, bucketRequestName(bucket));
    },
    getBucketPolicy: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketPolicy(selectedScopeId, bucketRequestName(bucket));
    },
    getBucketProperties: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketProperties(selectedScopeId, bucketRequestName(bucket));
    },
    getBucketWebsite: async (bucket) => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      return getBucketWebsite(selectedScopeId, bucketRequestName(bucket));
    },
  });

  const resetBucketTooltipState = useCallback(() => {
    generationRef.current += 1;
    setActiveOwnerTooltipKey(null);
    setOwnerTooltipState({});
    ownerTooltipInflightRef.current = {};
    ownerNameCacheRef.current = {};
    resetFeatureTooltipState();
  }, [resetFeatureTooltipState]);

  useEffect(() => {
    resetBucketTooltipState();
    return () => {
      generationRef.current += 1;
    };
  }, [resetBucketTooltipState, selectedScopeId]);

  const resolveOwnerNameForBucket = useCallback(
    async (bucket: CephAdminBucket): Promise<string | null> => {
      const inlineOwnerName = (bucket.owner_name || "").trim();
      if (inlineOwnerName) return inlineOwnerName;
      if (!selectedScopeId) return null;

      const bucketKey = bucketTooltipCacheKey(bucket);
      if (Object.prototype.hasOwnProperty.call(ownerNameCacheRef.current, bucketKey)) {
        return ownerNameCacheRef.current[bucketKey];
      }
      const generation = generationRef.current;

      const rules: Array<Record<string, unknown>> = [
        { field: "name", op: "eq", value: bucket.name },
      ];
      if (bucket.tenant?.trim()) {
        rules.push({ field: "tenant", op: "eq", value: bucket.tenant });
      }
      if (bucket.owner?.trim()) {
        rules.push({ field: "owner", op: "eq", value: bucket.owner });
      }
      const response = await listBuckets(selectedScopeId, {
        page: 1,
        page_size: 5,
        advanced_filter: serializeAdvancedFilterRules(rules),
        include: ["owner_name"],
        with_stats: false,
      });
      const candidate = response.items.find(
        (item) =>
          item.name === bucket.name &&
          (item.tenant ?? "") === (bucket.tenant ?? "") &&
          (item.owner ?? "") === (bucket.owner ?? ""),
      );
      const resolvedOwnerName = (candidate?.owner_name || "").trim() || null;
      if (generation === generationRef.current) {
        ownerNameCacheRef.current[bucketKey] = resolvedOwnerName;
      }
      return resolvedOwnerName;
    },
    [bucketTooltipCacheKey, listBuckets, selectedScopeId],
  );

  const loadOwnerTooltip = useCallback(
    (bucket: CephAdminBucket) => {
      if (!selectedScopeId || !bucket.owner) return;
      const key = ownerTooltipCacheKey(bucket);
      const current = ownerTooltipState[key];
      if (current?.status === "ready" || current?.status === "loading") return;
      if (ownerTooltipInflightRef.current[key]) return;

      const generation = generationRef.current;
      const work = (async () => {
        setOwnerTooltipState((previous) => ({
          ...previous,
          [key]: { status: "loading" },
        }));
        try {
          const ownerName = await resolveOwnerNameForBucket(bucket);
          if (generation !== generationRef.current) return;
          setOwnerTooltipState((previous) => ({
            ...previous,
            [key]: { status: "ready", ownerName },
          }));
        } catch (error) {
          if (generation !== generationRef.current) return;
          setOwnerTooltipState((previous) => ({
            ...previous,
            [key]: { status: "error", message: extractError(error) },
          }));
        } finally {
          if (generation === generationRef.current) {
            delete ownerTooltipInflightRef.current[key];
          }
        }
      })();
      ownerTooltipInflightRef.current[key] = work;
    },
    [extractError, ownerTooltipCacheKey, ownerTooltipState, resolveOwnerNameForBucket, selectedScopeId],
  );

  return {
    activeFeatureTooltipKey,
    activeOwnerTooltipKey,
    featureTooltipCacheKey,
    featureTooltipState,
    loadFeatureTooltip,
    loadOwnerTooltip,
    ownerTooltipCacheKey,
    ownerTooltipState,
    resetBucketTooltipState,
    setActiveFeatureTooltipKey,
    setActiveOwnerTooltipKey,
  };
}
