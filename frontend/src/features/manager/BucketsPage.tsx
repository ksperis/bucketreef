/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import TableSortControls from "../../components/list/TableSortControls";
import { ListActions, ListBadge, ListActionButton, ListActionLink } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import {
  createBucket,
  deleteBucket,
  listBuckets,
} from "../../api/managerBuckets";
import {
  getBucketCors,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketWebsite,
} from "../../api/bucketDetails";
import type {
  Bucket,
  BucketFeatureStatus,
  BucketProperties,
  BucketTag,
} from "../../api/bucketContracts";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiMeterBar from "../../components/ui/UiMeterBar";

import ColumnVisibilityMenu from "../../components/ColumnVisibilityMenu";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import { extractApiError, extractApiErrorCode } from "../../utils/apiError";
import { formatBytes, formatNumber } from "../../utils/format";
import { compareByNullableField, nextSortState, type SortableField } from "../../utils/sortValues";
import { getManagerToolAccess, readStoredUser } from "../../utils/workspaces";
import {
  readSessionJsonFromKey,
  writeSessionJsonToKey,
} from "../../utils/clientStorage";
import { formatAccountLabel } from "../shared/storageEndpointLabel";
import BucketPurgeRunModal from "../shared/BucketPurgeRunModal";
import { BucketFeatureSummaryChip, BucketSummaryTooltip } from "../shared/BucketFeatureSummaryTooltip";
import type { BucketFeatureTooltipState } from "../shared/BucketFeatureSummaryTooltip";
import {
  buildBucketPolicySummaryLines,
  buildBucketTagSummaryLines,
  buildCorsRuleSummaryLines,
  buildLifecycleRuleSummaryLines,
  buildLoggingSummaryLines,
  buildNotificationSummaryLines,
  buildObjectLockSummaryLines,
  buildPublicAccessBlockSummaryLines,
  buildVersioningSummaryLines,
  buildWebsiteSummaryLines,
} from "../shared/bucketFeatureSummaries";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import BucketCreateWorkflow from "./BucketCreateWorkflow";
import { useManagerI18n } from "./managerI18n";

function QuotaBar({ usedBytes, quotaBytes }: { usedBytes?: number | null; quotaBytes?: number | null }) {
  const { text } = useManagerI18n();
  if (!quotaBytes || quotaBytes <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedBytes ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaBytes) * 100));
  const usedDisplay = formatBytes(used);
  const quotaDisplay = formatBytes(quotaBytes);
  return (
    <div className="flex items-center gap-2" title={`${usedDisplay} / ${quotaDisplay}`}>
      <UiMeterBar
        value={ratio}
        label={text("Storage quota usage")}
        className="h-2.5 flex-1 overflow-hidden bg-slate-200 dark:bg-slate-800"
        barClassName="bg-primary-500"
      />
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

function QuotaObjectsBar({ usedObjects, quotaObjects }: { usedObjects?: number | null; quotaObjects?: number | null }) {
  const { text } = useManagerI18n();
  if (!quotaObjects || quotaObjects <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedObjects ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaObjects) * 100));
  return (
    <div className="flex items-center gap-2" title={`${formatNumber(used)} / ${formatNumber(quotaObjects)} objects`}>
      <UiMeterBar
        value={ratio}
        label={text("Object quota usage")}
        className="h-2.5 flex-1 overflow-hidden bg-slate-200 dark:bg-slate-800"
        barClassName="bg-primary-500"
      />
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

const formatObjectCountLabel = (value: number) => {
  const suffix = value === 1 ? "object" : "objects";
  return `${formatNumber(value)} ${suffix}`;
};

type BucketListRow = Bucket & {
  tags?: BucketTag[] | null;
  features?: Record<string, BucketFeatureStatus> | null;
};
type SortField = SortableField<BucketListRow>;

type ColumnId =
  | "used_bytes"
  | "object_count"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "creation_date"
  | "tags"
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications"
  | "quota_status";

type ManagerFeatureKey =
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications";

const MANAGER_FEATURE_LABELS: Record<ManagerFeatureKey, string> = {
  versioning: "Versioning",
  object_lock: "Object Lock",
  block_public_access: "Block public access",
  lifecycle_rules: "Lifecycle rules",
  static_website: "Static website",
  bucket_policy: "Bucket policy",
  cors: "CORS",
  access_logging: "Access logging",
  notifications: "Notifications",
};

const COLUMNS_STORAGE_KEY = "manager.bucket_list.columns.session.v1";
const defaultVisibleColumns: ColumnId[] = ["used_bytes", "object_count"];

const loadVisibleColumns = (): ColumnId[] => {
  const parsed = readSessionJsonFromKey<unknown>(COLUMNS_STORAGE_KEY);
  if (!Array.isArray(parsed)) return defaultVisibleColumns;
  const allowed = new Set<ColumnId>([
    "used_bytes",
    "object_count",
    "quota_max_size_bytes",
    "quota_max_objects",
    "creation_date",
    "tags",
    "versioning",
    "object_lock",
    "block_public_access",
    "lifecycle_rules",
    "static_website",
    "bucket_policy",
    "cors",
    "access_logging",
    "notifications",
    "quota_status",
  ]);
  const cleaned = parsed.filter((v) => typeof v === "string" && allowed.has(v as ColumnId)) as ColumnId[];
  return cleaned.length > 0 ? cleaned : defaultVisibleColumns;
};

const persistVisibleColumns = (value: ColumnId[]) => {
  writeSessionJsonToKey(COLUMNS_STORAGE_KEY, value);
};

export default function BucketsPage() {
  const { text, intlLocale } = useManagerI18n();
  const {
    contexts,
    selectedContextId,
    requiresContextSelection,
    sessionAccountName,
    contextIdForApi,
  } = useExecutionContext();
  const { generalSettings } = useGeneralSettings();
  const storedUser = readStoredUser();
  const managerToolAccess = getManagerToolAccess(storedUser);
  const [buckets, setBuckets] = useState<BucketListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseLoadFailed, setBaseLoadFailed] = useState(false);
  const [dataStale, setDataStale] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<string | null>(null);
  const [pendingDeleteBucketName, setPendingDeleteBucketName] = useState<string | null>(null);
  const [pendingDeleteWithPurgeBucketName, setPendingDeleteWithPurgeBucketName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filter, setFilter] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const fetchRequestRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const lastFetchContextRef = useRef<string | null>(null);
  const [activeFeatureTooltipKey, setActiveFeatureTooltipKey] = useState<string | null>(null);
  const [featureTooltipState, setFeatureTooltipState] = useState<Record<string, BucketFeatureTooltipState>>({});
  const featureTooltipInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const bucketPropertiesCacheRef = useRef<Record<string, BucketProperties>>({});
  const bucketPropertiesInflightRef = useRef<Record<string, Promise<BucketProperties>>>({});
  const [activeTagsTooltipKey, setActiveTagsTooltipKey] = useState<string | null>(null);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "used_bytes",
    direction: "desc",
  });
  const [enrichingColumns, setEnrichingColumns] = useState(false);

  const selectedS3Account = useMemo(
    () => contexts.find((a) => a.id === selectedContextId),
    [contexts, selectedContextId]
  );
  const endpointCaps = selectedS3Account?.storage_endpoint_capabilities ?? null;
  const usageFeatureEnabled = endpointCaps ? endpointCaps.metrics !== false : true;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const staticWebsiteFeatureEnabled = endpointCaps?.static_website === true;
  const quotaFeatureEnabled = selectedS3Account?.endpoint_provider === "ceph";
  const metricColumnOptions = useMemo(
    () => [
      { id: "used_bytes" as const, label: text("Used") },
      { id: "object_count" as const, label: text("Objects") },
      ...(quotaFeatureEnabled
        ? ([
            { id: "quota_max_size_bytes" as const, label: text("Quota") },
            { id: "quota_max_objects" as const, label: text("Object quota") },
            { id: "quota_status" as const, label: text("Quota status") },
          ] as const)
        : []),
      { id: "creation_date" as const, label: text("Created on") },
      { id: "tags" as const, label: text("Tags") },
    ],
    [quotaFeatureEnabled, text]
  );
  const featureColumnOptions = useMemo(
    () =>
      ([
        { id: "versioning", label: text("Versioning"), key: "versioning" },
        { id: "object_lock", label: text("Object Lock"), key: "object_lock" },
        { id: "block_public_access", label: text("Block public access"), key: "block_public_access" },
        { id: "lifecycle_rules", label: text("Lifecycle rules"), key: "lifecycle_rules" },
        { id: "static_website", label: text("Static website"), key: "static_website" },
        { id: "bucket_policy", label: text("Bucket policy"), key: "bucket_policy" },
        { id: "cors", label: text("CORS"), key: "cors" },
        { id: "access_logging", label: text("Access logging"), key: "access_logging" },
        { id: "notifications", label: text("Notifications"), key: "notifications" },
      ].filter(
        (option) =>
          (option.id !== "static_website" || staticWebsiteFeatureEnabled) &&
          (option.id !== "notifications" || snsFeatureEnabled)
      ) as Array<{ id: ManagerFeatureKey; label: string; key: ManagerFeatureKey }>),
    [snsFeatureEnabled, staticWebsiteFeatureEnabled, text]
  );
  const accountLabel = selectedS3Account
    ? formatAccountLabel(selectedS3Account)
    : requiresContextSelection
      ? "Not selected"
      : sessionAccountName || "S3 session";
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const canDeleteBucketWithPurge =
    isFeaturePolicyAvailable(generalSettings.manager_feature_policies.bucket_purge) && Boolean(managerToolAccess?.bucket_purge);

  const includeParams = useMemo(() => {
    const include: string[] = [];
    if (visibleColumns.includes("tags")) include.push("tags");
    featureColumnOptions.forEach(({ id }) => {
      if (visibleColumns.includes(id)) include.push(id);
    });
    return include;
  }, [featureColumnOptions, visibleColumns]);

  const requiresStats = useMemo(
    () =>
      usageFeatureEnabled &&
      (visibleColumns.includes("used_bytes") ||
        visibleColumns.includes("object_count") ||
        (quotaFeatureEnabled &&
          (visibleColumns.includes("quota_max_size_bytes") ||
            visibleColumns.includes("quota_max_objects") ||
            visibleColumns.includes("quota_status")))),
    [usageFeatureEnabled, visibleColumns, quotaFeatureEnabled]
  );

  type ColumnDef = DataTableColumn<BucketListRow, SortField>;

  const quotaConfigured = (bucket: BucketListRow) =>
    Boolean((bucket.quota_max_size_bytes ?? 0) > 0 || (bucket.quota_max_objects ?? 0) > 0);

  const bucketTooltipCacheKey = (bucket: BucketListRow) => bucket.name;
  const featureTooltipCacheKey = (bucket: BucketListRow, featureKey: ManagerFeatureKey) =>
    `${bucketTooltipCacheKey(bucket)}:${featureKey}`;
  const tagsTooltipCacheKey = (bucketName: string) => `${bucketName}:tags`;

  const getBucketPropertiesCached = async (bucket: BucketListRow): Promise<BucketProperties> => {
    const bucketKey = bucketTooltipCacheKey(bucket);
    const cached = bucketPropertiesCacheRef.current[bucketKey];
    if (cached) return cached;
    const inflight = bucketPropertiesInflightRef.current[bucketKey];
    if (inflight) return inflight;
    const accountId = contextIdForApi;
    const promise = getBucketProperties(accountId, bucket.name)
      .then((properties) => {
        bucketPropertiesCacheRef.current[bucketKey] = properties;
        return properties;
      })
      .finally(() => {
        delete bucketPropertiesInflightRef.current[bucketKey];
      });
    bucketPropertiesInflightRef.current[bucketKey] = promise;
    return promise;
  };

  const buildFeatureTooltipLines = async (bucket: BucketListRow, featureKey: ManagerFeatureKey): Promise<string[]> => {
    const accountId = contextIdForApi;

    if (featureKey === "versioning") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildVersioningSummaryLines(properties.versioning_status);
    }

    if (featureKey === "object_lock") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildObjectLockSummaryLines(properties.object_lock_enabled, properties.object_lock);
    }

    if (featureKey === "block_public_access") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildPublicAccessBlockSummaryLines(properties.public_access_block as Record<string, unknown> | null | undefined);
    }

    if (featureKey === "lifecycle_rules") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildLifecycleRuleSummaryLines(properties.lifecycle_rules as unknown[]);
    }

    if (featureKey === "cors") {
      const properties = await getBucketPropertiesCached(bucket);
      const inlineRules = Array.isArray(properties.cors_rules) ? properties.cors_rules : null;
      if (inlineRules) return buildCorsRuleSummaryLines(inlineRules);
      const cors = await getBucketCors(accountId, bucket.name);
      return buildCorsRuleSummaryLines(cors.rules);
    }

    if (featureKey === "static_website") {
      const website = await getBucketWebsite(accountId, bucket.name);
      return buildWebsiteSummaryLines(website as Record<string, unknown>);
    }

    if (featureKey === "bucket_policy") {
      const policy = await getBucketPolicy(accountId, bucket.name);
      return buildBucketPolicySummaryLines(policy.policy);
    }

    if (featureKey === "access_logging") {
      const logging = await getBucketLogging(accountId, bucket.name);
      return buildLoggingSummaryLines(logging as Record<string, unknown>);
    }

    if (featureKey === "notifications") {
      const notifications = await getBucketNotifications(accountId, bucket.name);
      return buildNotificationSummaryLines(notifications.configuration);
    }

    return [text("No additional details available.")];
  };

  const loadFeatureTooltip = (bucket: BucketListRow, featureKey: ManagerFeatureKey) => {
    if (needsContextSelection) return;
    const key = featureTooltipCacheKey(bucket, featureKey);
    const current = featureTooltipState[key];
    if (current?.status === "ready" || current?.status === "loading") return;
    if (featureTooltipInflightRef.current[key]) return;

    const work = (async () => {
      setFeatureTooltipState((prev) => ({ ...prev, [key]: { status: "loading" } }));
      try {
        const lines = await buildFeatureTooltipLines(bucket, featureKey);
        setFeatureTooltipState((prev) => ({ ...prev, [key]: { status: "ready", lines } }));
      } catch (err) {
        setFeatureTooltipState((prev) => ({
          ...prev,
          [key]: { status: "error", message: extractApiError(err, text("Unable to load bucket feature details.")) },
        }));
      } finally {
        delete featureTooltipInflightRef.current[key];
      }
    })();
    featureTooltipInflightRef.current[key] = work;
  };

  const renderTagList = (tags?: BucketTag[] | null, bucketName = "bucket") => {
    const safeTags = Array.isArray(tags) ? tags.filter((t) => (t.key ?? "").trim()) : [];
    if (safeTags.length === 0) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const maxShown = 3;
    const shown = safeTags.slice(0, maxShown);
    const remaining = safeTags.length - shown.length;
    const tagKey = tagsTooltipCacheKey(bucketName);
    const tooltip: BucketFeatureTooltipState = { status: "ready", lines: buildBucketTagSummaryLines(safeTags) };
    return (
      <BucketSummaryTooltip
        label={text("S3 tags")}
        tooltip={tooltip}
        open={activeTagsTooltipKey === tagKey}
        onOpen={() => setActiveTagsTooltipKey(tagKey)}
        onClose={() => setActiveTagsTooltipKey((prev) => (prev === tagKey ? null : prev))}
        cacheKey={tagKey}
        buttonClassName="inline-flex max-w-full cursor-default text-left"
      >
        <div className="flex flex-wrap gap-1.5">
          {shown.map((t) => (
            <ListBadge
              key={`${t.key}:${t.value}`}
              tone="neutral"
            >
              {t.key}={t.value}
            </ListBadge>
          ))}
          {remaining > 0 && (
            <ListBadge tone="neutral">
              +{remaining}
            </ListBadge>
          )}
        </div>
      </BucketSummaryTooltip>
    );
  };

  const renderFeatureChip = (featureKey: ManagerFeatureKey, bucket: BucketListRow) => {
    const status = bucket.features?.[featureKey] ?? null;
    if (!status) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const tooltipKey = featureTooltipCacheKey(bucket, featureKey);
    return (
      <BucketFeatureSummaryChip
        label={MANAGER_FEATURE_LABELS[featureKey]}
        state={status.state}
        tone={status.tone}
        tooltip={featureTooltipState[tooltipKey]}
        open={activeFeatureTooltipKey === tooltipKey}
        onOpen={() => {
          setActiveFeatureTooltipKey(tooltipKey);
          loadFeatureTooltip(bucket, featureKey);
        }}
        onClose={() => setActiveFeatureTooltipKey((prev) => (prev === tooltipKey ? null : prev))}
        cacheKey={tooltipKey}
      />
    );
  };

  const fetchBuckets = useCallback(async (accountId: S3ExecutionContextSelector) => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const requestId = fetchRequestRef.current + 1;
    fetchRequestRef.current = requestId;
    setError(null);
    setLoading(true);
    setEnrichingColumns(false);
    try {
      const baseData = await listBuckets(accountId, {
        with_stats: requiresStats,
        signal: controller.signal,
      });
      if (fetchRequestRef.current !== requestId || controller.signal.aborted) return;
      setBuckets(baseData);
      setBaseLoadFailed(false);
      setDataStale(false);
      setLastUpdatedAt(new Date());
      setLoading(false);

      if (includeParams.length === 0) return;

      setEnrichingColumns(true);
      try {
        const enrichedData = await listBuckets(accountId, {
          include: includeParams,
          with_stats: requiresStats,
          signal: controller.signal,
        });
        if (fetchRequestRef.current !== requestId || controller.signal.aborted) return;
        setBuckets(enrichedData);
      } catch (err) {
        if (fetchRequestRef.current !== requestId) return;
        setError(extractApiError(err, text("Unable to update selected bucket details.")));
      } finally {
        if (fetchRequestRef.current === requestId) {
          setEnrichingColumns(false);
        }
      }
    } catch (err) {
      if (fetchRequestRef.current !== requestId || controller.signal.aborted) return;
      setError(extractApiError(err, text("Unable to load buckets from the storage endpoint.")));
      setBaseLoadFailed(true);
      setDataStale(true);
      setEnrichingColumns(false);
    } finally {
      if (fetchRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [includeParams, requiresStats, text]);

  useEffect(() => {
    fetchAbortRef.current?.abort();
    if (needsContextSelection) {
      fetchRequestRef.current += 1;
      setLoading(false);
      setEnrichingColumns(false);
      setBuckets([]);
      setDataStale(false);
      setLastUpdatedAt(null);
      setBaseLoadFailed(false);
      lastFetchContextRef.current = null;
      return;
    }
    const contextKey = contextIdForApi ?? "session";
    if (lastFetchContextRef.current !== contextKey) {
      setBuckets([]);
      setDataStale(false);
      setLastUpdatedAt(null);
      setBaseLoadFailed(false);
      lastFetchContextRef.current = contextKey;
    }
    fetchBuckets(contextIdForApi);
    return () => fetchAbortRef.current?.abort();
  }, [contextIdForApi, fetchBuckets, needsContextSelection]);

  useEffect(() => {
    setActiveFeatureTooltipKey(null);
    setFeatureTooltipState({});
    featureTooltipInflightRef.current = {};
    bucketPropertiesCacheRef.current = {};
    bucketPropertiesInflightRef.current = {};
    setActiveTagsTooltipKey(null);
  }, [contextIdForApi]);

  useEffect(() => {
    persistVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    setVisibleColumns((prev) => {
      const next = prev.filter((column) => {
        if (column === "static_website" && !staticWebsiteFeatureEnabled) return false;
        if (column === "notifications" && !snsFeatureEnabled) return false;
        if (
          (column === "quota_max_size_bytes" || column === "quota_max_objects" || column === "quota_status") &&
          !quotaFeatureEnabled
        ) {
          return false;
        }
        return true;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [quotaFeatureEnabled, snsFeatureEnabled, staticWebsiteFeatureEnabled]);

  const filteredBuckets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = q ? buckets.filter((b) => b.name.toLowerCase().includes(q)) : buckets;
    const sorted = [...items].sort((a, b) => {
      return compareByNullableField(a, b, sort.field, sort.direction);
    });
    return sorted;
  }, [buckets, filter, sort]);

  const toggleSort = (field: SortField) => {
    setSort((current) => nextSortState(current, field, "desc"));
  };

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const performCreate = async (
    name: string,
    versioning: boolean,
    locationConstraint?: string
  ): Promise<{ created: boolean }> => {
    if (needsContextSelection) {
      setActionError(text("Select an account before creating a bucket."));
      return { created: false };
    }
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createBucket(name, contextIdForApi, {
        versioning,
        locationConstraint,
      });
      setActionMessage(text("Bucket created"));
      await fetchBuckets(contextIdForApi);
      return { created: true };
    } catch (err) {
      setActionError(extractApiError(err, text("Unable to create the bucket.")));
      return { created: false };
    } finally {
      setCreating(false);
    }
  };

  const requestDelete = (name: string) => {
    if (needsContextSelection) return;
    const targetBucket = buckets.find((b) => b.name === name);
    const objectCount = targetBucket?.object_count;
    if ((objectCount ?? 0) > 0) {
      if (canDeleteBucketWithPurge) {
        setActionError(null);
        setActionMessage(null);
        setPendingDeleteWithPurgeBucketName(name);
        return;
      }
      setActionMessage(null);
      setActionError(
        text("Bucket '{name}' is not empty ({count}). Empty it before deleting, or enable bucket purge access to delete it from Manager.", {
          name,
          count: formatObjectCountLabel(objectCount ?? 0),
        })
      );
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setPendingDeleteBucketName(name);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteBucketName) return;
    const name = pendingDeleteBucketName;
    setDeletingBucket(name);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteBucket(name, contextIdForApi);
      setActionMessage(text("Bucket deleted"));
      await fetchBuckets(contextIdForApi);
      return;
    } catch (err) {
      const msg = extractApiError(err, text("Unable to delete bucket '{name}'.", { name }));
      if (extractApiErrorCode(err) === "bucket_not_empty") {
        setActionError(text("Bucket '{name}' is not empty. Empty it before deleting.", { name }));
        return;
      }
      setActionError(msg);
    } finally {
      setDeletingBucket(null);
      setPendingDeleteBucketName(null);
    }
  };

  const handleDeleteWithPurgeFinished = async (result: { bucket_deleted?: boolean; deleted_objects?: number; deleted_versions?: number }) => {
    if (!result.bucket_deleted) return;
    const deletedEntries = (result.deleted_objects ?? 0) + (result.deleted_versions ?? 0);
    const entryLabel = text(deletedEntries === 1 ? "entry" : "entries");
    setActionError(null);
    setActionMessage(text("Bucket deleted after removing {count} {entryLabel}.", {
      count: deletedEntries.toLocaleString(intlLocale),
      entryLabel,
    }));
    await fetchBuckets(contextIdForApi);
  };

  const bucketTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "name",
        label: text("Name"),
        field: "name",
        primary: true,
        mobileRole: "primary",
        render: (bucket) => <span className="block truncate">{bucket.name}</span>,
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("used_bytes")) {
      cols.push({
        id: "used_bytes",
        label: text("Used"),
        field: "used_bytes",
        render: (bucket) => formatBytes(bucket.used_bytes),
      });
    }
    if (quotaFeatureEnabled && visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: text("Quota"),
        field: "quota_max_size_bytes",
        render: (bucket) => <QuotaBar usedBytes={bucket.used_bytes} quotaBytes={bucket.quota_max_size_bytes ?? null} />,
      });
    }
    if (visible.has("object_count")) {
      cols.push({
        id: "object_count",
        label: text("Objects"),
        field: "object_count",
        render: (bucket) => formatNumber(bucket.object_count),
      });
    }
    if (quotaFeatureEnabled && visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: text("Object quota"),
        field: "quota_max_objects",
        render: (bucket) => <QuotaObjectsBar usedObjects={bucket.object_count} quotaObjects={bucket.quota_max_objects ?? null} />,
      });
    }
    if (visible.has("creation_date")) {
      cols.push({
        id: "creation_date",
        label: text("Created on"),
        field: null,
        render: (bucket) => (bucket.creation_date ? new Date(bucket.creation_date).toLocaleDateString(intlLocale) : "-"),
      });
    }
    if (visible.has("tags")) {
      cols.push({
        id: "tags",
        label: text("Tags"),
        field: null,
        render: (bucket) => renderTagList(bucket.tags, bucket.name),
      });
    }

    featureColumnOptions.forEach((c) => {
      if (!visible.has(c.id)) return;
      cols.push({
        id: c.id,
        label: c.label,
        field: null,
        render: (bucket) => renderFeatureChip(c.key, bucket),
      });
    });

    if (quotaFeatureEnabled && visible.has("quota_status")) {
      cols.push({
        id: "quota_status",
        label: text("Quota status"),
        field: null,
        render: (bucket) => (
          <PropertySummaryChip
            compact
            state={text(quotaConfigured(bucket) ? "Configured" : "Not set")}
            tone={quotaConfigured(bucket) ? "active" : "inactive"}
            title={text("Quota: {status}", { status: text(quotaConfigured(bucket) ? "Configured" : "Not set") })}
          />
        ),
      });
    }

    cols.push({
      id: "actions",
      label: text("Actions"),
      field: null,
      align: "right",
      headerClassName: "min-w-[13rem]",
      cellClassName: "min-w-[13rem]",
      mobileRole: "actions",
      render: (bucket) => {
        const objectCount = bucket.object_count;
        const containsObjects = (objectCount ?? 0) > 0;
        const deleteDisabledReason =
          containsObjects && !canDeleteBucketWithPurge
            ? text("Bucket is not empty. Empty it first, or enable bucket purge access to delete it from Manager.")
            : null;
        const deleteLabel = text(containsObjects && canDeleteBucketWithPurge ? "Purge and Delete" : "Delete");
        const deleteButton = (
          <ListActionButton
            onClick={() => requestDelete(bucket.name)}
             variant="danger" className={`whitespace-nowrap`}
            disabled={deletingBucket === bucket.name || Boolean(deleteDisabledReason)}
          >
            {deletingBucket === bucket.name ? text("Deleting...") : deleteLabel}
          </ListActionButton>
        );
        return (
          <ListActions className="flex-nowrap">
            <ListActionLink
              to={`/manager/buckets/${encodeURIComponent(bucket.name)}`}
               className={`whitespace-nowrap`}
              {...dataTableDefaultActionProps}
            >
              {text("Configure")}
            </ListActionLink>
            {deleteDisabledReason ? <span title={deleteDisabledReason}>{deleteButton}</span> : deleteButton}
          </ListActions>
        );
      },
    });

    return cols;
  })();
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredBuckets.length,
  });

  const openCreateForm = () => {
    setActionError(null);
    setShowCreateForm(true);
  };

  return (
    <div className={workflowPageHostClass(Boolean(showCreateForm || pendingDeleteWithPurgeBucketName))}>
      <PageHeader actionPresentation="listing"
        title={text("Buckets")}
        description={text("Bucket inventory and configuration for the active manager context.")}
        breadcrumbs={managerPageBreadcrumbs(text, "buckets")}
        actions={[
          {
            label: text("Create bucket"),
            onClick: openCreateForm,
            disabled: baseLoadFailed || (loading && buckets.length === 0),
          },
        ]}
      />

      {error && (
        <PageBanner tone={buckets.length > 0 || !baseLoadFailed ? "warning" : "error"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {buckets.length > 0 && dataStale ? `${text("Showing the last available bucket list.")} ` : ""}
              {text(error)}
              {lastUpdatedAt ? ` ${text("Last updated {time}.", { time: lastUpdatedAt.toLocaleTimeString(intlLocale) })}` : ""}
            </span>
            <ListActionButton
              variant="ghost"
              onClick={() => fetchBuckets(contextIdForApi)}
            >
              {text("Retry")}
            </ListActionButton>
          </div>
        </PageBanner>
      )}
      {actionError && <PageBanner tone="error">{text(actionError)}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {needsContextSelection ? (
        <PageEmptyState
          title={text("Select an account before managing buckets")}
          description={text("The bucket list, quota details, and destructive actions stay disabled until a manager execution context is selected.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
          variant="page"
          mobileSort={<TableSortControls columns={bucketTableColumns} sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }} />}
            title={text("Buckets")}
            countLabel={
              buckets.length === 0 && (loading || baseLoadFailed)
                ? text("— buckets")
                : text(filteredBuckets.length === 1 ? "{count} bucket" : "{count} buckets", { count: filteredBuckets.length })
            }
            search={
              <ManagerToolbarSearch
                value={filter}
                onChange={setFilter}
                placeholder={text("Search by name")}
                className="w-full sm:w-64 md:w-72"
              />
            }
            columns={
              <>
                {enrichingColumns ? (
                  <span className="ui-caption text-slate-500 dark:text-slate-400">{text("Updating selected columns...")}</span>
                ) : null}
                <ColumnVisibilityMenu
                  selectedCount={visibleColumns.length}
                  onReset={resetColumns}
                  resetDisabled={visibleColumns.length === defaultVisibleColumns.length && defaultVisibleColumns.every((id) => visibleColumns.includes(id))}
                  coreGroups={[
                    { id: "metrics", label: text("Metrics"), options: metricColumnOptions },
                    { id: "features", label: text("Features"), options: featureColumnOptions },
                  ].map((group) => ({
                    ...group,
                    options: group.options.map((option) => ({
                      ...option,
                      checked: visibleColumns.includes(option.id),
                      onToggle: () => toggleColumn(option.id),
                    })),
                  }))}
                  footerNote={text("Feature checks run only when their column is enabled.")}
                />
              </>
            }
        >
          <DataTableShell
            columns={bucketTableColumns}
            rows={filteredBuckets}
            rowKey={(bucket) => bucket.name}
            responsiveCards
            tableClassName="w-full min-w-[760px]"
            tableLayout="fixed"
            sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
            status={tableStatus}
            loadingMessage={text("Loading buckets...")}
            errorMessage={text("Unable to load buckets.")}
            emptyMessage={text(filter.trim() ? "No buckets match this search." : "No buckets.")}
          />
        </ListPageSection>
      )}

      {pendingDeleteBucketName && (
        <ConfirmActionDialog
          title={text("Delete bucket")}
          description={text("This permanently removes the bucket after server-side checks confirm it is empty.")}
          confirmLabel={text("Delete bucket")}
          details={[
            { label: text("Bucket"), value: pendingDeleteBucketName, mono: true },
            { label: text("Context"), value: accountLabel },
          ]}
          impacts={[
            text("Deletion is irreversible once the bucket is removed."),
            text("The bucket must remain empty until the operation completes."),
          ]}
          loading={deletingBucket === pendingDeleteBucketName}
          onCancel={() => setPendingDeleteBucketName(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}

      {pendingDeleteWithPurgeBucketName && contextIdForApi && (
        <BucketPurgeRunModal
          mode="manager-delete"
          contextId={contextIdForApi}
          contextName={accountLabel}
          targets={[{ bucketName: pendingDeleteWithPurgeBucketName }]}
          onFinished={(result) => void handleDeleteWithPurgeFinished(result)}
          onClose={() => setPendingDeleteWithPurgeBucketName(null)}
        />
      )}

      {showCreateForm && (
        <BucketCreateWorkflow contextLabel={accountLabel} needsContext={needsContextSelection}
          busy={creating} error={actionError} onCreate={performCreate} onClose={() => setShowCreateForm(false)} />
      )}
    </div>
  );
}
