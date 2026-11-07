/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BucketCors,
  BucketEncryptionConfiguration,
  BucketLoggingConfiguration,
  BucketNotificationConfiguration,
  BucketPolicy,
  BucketProperties,
  BucketWebsiteConfiguration,
} from "../../api/bucketContracts";
import {
  buildBucketPolicySummaryLines,
  buildCorsRuleSummaryLines,
  buildEncryptionSummaryLines,
  buildLifecycleRuleSummaryLines,
  buildLoggingSummaryLines,
  buildNotificationSummaryLines,
  buildObjectLockSummaryLines,
  buildPublicAccessBlockSummaryLines,
  buildVersioningSummaryLines,
  buildWebsiteSummaryLines,
} from "./bucketFeatureSummaries";
import type { FeatureKey } from "./bucketOpsAdvancedFilterModel";
import type { BucketFeatureTooltipState } from "./BucketFeatureSummaryTooltip";

type BucketFeatureTooltipTarget = {
  name: string;
};

type BucketFeatureTooltipLoaders<TBucket extends BucketFeatureTooltipTarget> = {
  getBucketCors?: (bucket: TBucket) => Promise<BucketCors>;
  getBucketEncryption?: (bucket: TBucket) => Promise<BucketEncryptionConfiguration>;
  getBucketLogging: (bucket: TBucket) => Promise<BucketLoggingConfiguration>;
  getBucketNotifications: (bucket: TBucket) => Promise<BucketNotificationConfiguration>;
  getBucketPolicy: (bucket: TBucket) => Promise<BucketPolicy>;
  getBucketProperties: (bucket: TBucket) => Promise<BucketProperties>;
  getBucketWebsite: (bucket: TBucket) => Promise<BucketWebsiteConfiguration>;
};

type UseBucketFeatureTooltipsInput<TBucket extends BucketFeatureTooltipTarget> =
  BucketFeatureTooltipLoaders<TBucket> & {
    bucketCacheKey: (bucket: TBucket) => string;
    enabled: boolean;
    extractError: (error: unknown) => string;
    noAdditionalDetails?: string;
  };

export function useBucketFeatureTooltips<TBucket extends BucketFeatureTooltipTarget>({
  bucketCacheKey,
  enabled,
  extractError,
  getBucketCors,
  getBucketEncryption,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketWebsite,
  noAdditionalDetails = "No additional details available.",
}: UseBucketFeatureTooltipsInput<TBucket>) {
  const [activeFeatureTooltipKey, setActiveFeatureTooltipKey] = useState<string | null>(null);
  const [featureTooltipState, setFeatureTooltipState] = useState<Record<string, BucketFeatureTooltipState>>({});
  const featureTooltipInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const bucketPropertiesCacheRef = useRef<Record<string, BucketProperties>>({});
  const bucketPropertiesInflightRef = useRef<Record<string, Promise<BucketProperties>>>({});
  const generationRef = useRef(0);

  const featureTooltipCacheKey = useCallback(
    (bucket: TBucket, featureKey: FeatureKey) => `${bucketCacheKey(bucket)}:${featureKey}`,
    [bucketCacheKey],
  );

  const resetFeatureTooltipState = useCallback(() => {
    generationRef.current += 1;
    setActiveFeatureTooltipKey(null);
    setFeatureTooltipState({});
    featureTooltipInflightRef.current = {};
    bucketPropertiesCacheRef.current = {};
    bucketPropertiesInflightRef.current = {};
  }, []);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  const getBucketPropertiesCached = useCallback(
    async (bucket: TBucket): Promise<BucketProperties> => {
      const bucketKey = bucketCacheKey(bucket);
      const cached = bucketPropertiesCacheRef.current[bucketKey];
      if (cached) return cached;
      const inflight = bucketPropertiesInflightRef.current[bucketKey];
      if (inflight) return inflight;

      const generation = generationRef.current;
      const promise = getBucketProperties(bucket)
        .then((properties) => {
          if (generation === generationRef.current) {
            bucketPropertiesCacheRef.current[bucketKey] = properties;
          }
          return properties;
        })
        .finally(() => {
          if (bucketPropertiesInflightRef.current[bucketKey] === promise) {
            delete bucketPropertiesInflightRef.current[bucketKey];
          }
        });
      bucketPropertiesInflightRef.current[bucketKey] = promise;
      return promise;
    },
    [bucketCacheKey, getBucketProperties],
  );

  const buildFeatureTooltipLines = useCallback(
    async (bucket: TBucket, featureKey: FeatureKey): Promise<string[]> => {
      if (featureKey === "versioning") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildVersioningSummaryLines(properties.versioning_status);
      }
      if (featureKey === "object_lock") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildObjectLockSummaryLines(properties.object_lock);
      }
      if (featureKey === "block_public_access") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildPublicAccessBlockSummaryLines(properties.public_access_block);
      }
      if (featureKey === "lifecycle_rules") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildLifecycleRuleSummaryLines(properties.lifecycle_rules as unknown[]);
      }
      if (featureKey === "cors") {
        const properties = await getBucketPropertiesCached(bucket);
        if (Array.isArray(properties.cors_rules)) {
          return buildCorsRuleSummaryLines(properties.cors_rules);
        }
        const cors = await getBucketCors?.(bucket);
        return buildCorsRuleSummaryLines(cors?.rules);
      }
      if (featureKey === "static_website") {
        const website = await getBucketWebsite(bucket);
        return buildWebsiteSummaryLines(website as Record<string, unknown>);
      }
      if (featureKey === "bucket_policy") {
        const policy = await getBucketPolicy(bucket);
        return buildBucketPolicySummaryLines(policy.policy);
      }
      if (featureKey === "access_logging") {
        const logging = await getBucketLogging(bucket);
        return buildLoggingSummaryLines(logging as Record<string, unknown>);
      }
      if (featureKey === "notifications") {
        const notifications = await getBucketNotifications(bucket);
        return buildNotificationSummaryLines(notifications.configuration);
      }
      if (featureKey === "server_side_encryption" && getBucketEncryption) {
        const encryption = await getBucketEncryption(bucket);
        return buildEncryptionSummaryLines(encryption.rules);
      }
      return [noAdditionalDetails];
    },
    [
      getBucketCors,
      getBucketEncryption,
      getBucketLogging,
      getBucketNotifications,
      getBucketPolicy,
      getBucketPropertiesCached,
      getBucketWebsite,
      noAdditionalDetails,
    ],
  );

  const loadFeatureTooltip = useCallback(
    (bucket: TBucket, featureKey: FeatureKey) => {
      if (!enabled) return;
      const key = featureTooltipCacheKey(bucket, featureKey);
      const current = featureTooltipState[key];
      if (current?.status === "ready" || current?.status === "loading") return;
      if (featureTooltipInflightRef.current[key]) return;

      const generation = generationRef.current;
      const work = (async () => {
        setFeatureTooltipState((previous) => ({
          ...previous,
          [key]: { status: "loading" },
        }));
        try {
          const lines = await buildFeatureTooltipLines(bucket, featureKey);
          if (generation !== generationRef.current) return;
          setFeatureTooltipState((previous) => ({
            ...previous,
            [key]: { status: "ready", lines },
          }));
        } catch (error) {
          if (generation !== generationRef.current) return;
          setFeatureTooltipState((previous) => ({
            ...previous,
            [key]: { status: "error", message: extractError(error) },
          }));
        } finally {
          if (generation === generationRef.current) {
            delete featureTooltipInflightRef.current[key];
          }
        }
      })();
      featureTooltipInflightRef.current[key] = work;
    },
    [buildFeatureTooltipLines, enabled, extractError, featureTooltipCacheKey, featureTooltipState],
  );

  return {
    activeFeatureTooltipKey,
    featureTooltipCacheKey,
    featureTooltipState,
    loadFeatureTooltip,
    resetFeatureTooltipState,
    setActiveFeatureTooltipKey,
  };
}
