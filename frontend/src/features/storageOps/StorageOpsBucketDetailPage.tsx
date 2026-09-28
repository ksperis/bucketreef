/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ErrorState from "../../components/errors/ErrorState";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { STORAGE_OPS_SCOPE_ID, listStorageOpsBuckets, type StorageOpsBucket } from "../../api/storageOps";
import { listExecutionContexts } from "../../api/executionContexts";
import PageEmptyState from "../../components/PageEmptyState";
import WorkflowPage from "../../components/WorkflowPage";
import BucketDetailPage from "../manager/BucketDetailPage";
import { useBucketListBackNavigation } from "../shared/bucketListReturnContext";
import { storageOpsPageBreadcrumbs } from "./storageOpsBreadcrumbs";

export default function StorageOpsBucketDetailPage() {
  const { bucketName = "" } = useParams<{ bucketName: string }>();
  const [searchParams] = useSearchParams();
  const contextId = searchParams.get("ctx")?.trim() ?? "";
  const [bucket, setBucket] = useState<StorageOpsBucket | null>(null);
  const [contextAvailable, setContextAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(Boolean(bucketName && contextId));
  const [error, setError] = useState<unknown>(null);
  const { listUrl, onBack } = useBucketListBackNavigation("storage-ops", "/storage-ops/buckets");

  const exactFilter = useMemo(
    () =>
      JSON.stringify({
        match: "all",
        rules: [
          { field: "context_id", op: "eq", value: contextId },
          { field: "name", op: "eq", value: bucketName },
        ],
      }),
    [bucketName, contextId]
  );

  useEffect(() => {
    if (!bucketName || !contextId) {
      setBucket(null);
      setContextAvailable(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setContextAvailable(null);
    Promise.all([
      listExecutionContexts("manager", { signal: controller.signal }),
      listStorageOpsBuckets(
        STORAGE_OPS_SCOPE_ID,
        {
          page: 1,
          page_size: 1,
          advanced_filter: exactFilter,
          with_stats: false,
        },
        { signal: controller.signal }
      ),
    ])
      .then(([contexts, response]) => {
        const hasContext = contexts.some((context) => context.id === contextId);
        setContextAvailable(hasContext);
        if (!hasContext) {
          setBucket(null);
          return;
        }
        const match = response.items.find(
          (item) => item.context_id === contextId && (item.bucket_name ?? item.name) === bucketName
        );
        setBucket(match ?? null);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setBucket(null);
        setContextAvailable(null);
        setError(requestError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [bucketName, contextId, exactFilter]);

  const breadcrumbs = storageOpsPageBreadcrumbs(
    "buckets",
    { label: bucketName || "Bucket" },
  ).map((breadcrumb) =>
    breadcrumb.to === "/storage-ops/buckets" ? { ...breadcrumb, to: listUrl } : breadcrumb,
  );

  const backAction = { label: "Back to buckets", onClick: onBack };
  if (!contextId || !bucketName) return <ErrorState kind="invalid_link" primaryAction={backAction} />;
  if (!loading && error) return <ErrorState error={error} secondaryAction={backAction} />;
  if (!loading && contextAvailable === false) return <ErrorState kind="forbidden" primaryAction={backAction} />;
  if (!loading && !bucket) return <ErrorState kind="not_found" primaryAction={backAction} />;

  return (
    <WorkflowPage
      title={bucketName ? `Configure bucket · ${bucketName}` : "Bucket configuration"}
      description="Review and update the complete S3 API configuration for its selected execution context."
      breadcrumbs={breadcrumbs}
      backLabel="Back to buckets"
      onBack={onBack}
      contentVariant="plain"
    >
      {loading ? (
        <PageEmptyState eyebrow="Loading" title="Loading bucket configuration" description="Checking access to this bucket." />
      ) : (
        <BucketDetailPage
          mode="manager"
          bucketNameOverride={bucketName}
          accountIdOverride={contextId}
          hideQuotaTab
          embedded
          hideObjectsTab
        />
      )}
    </WorkflowPage>
  );
}
