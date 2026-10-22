/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3ExecutionContextSelector } from "../../../api/accountParams";
import {
  getBucketVersioning,
  setBucketVersioning,
} from "../../../api/bucketDetails";
import {
  getCephAdminBucketVersioning,
  setCephAdminBucketVersioning,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";

type UseBucketVersioningControllerOptions = {
  contextId: S3ExecutionContextSelector;
  bucketName?: string;
  cephAdmin: boolean;
  cephAdminTenant?: string | null;
  enabled: boolean;
  endpointId?: number | null;
};

function statusIsEnabled(status?: string | null): boolean {
  return (status ?? "").trim().toLowerCase() === "enabled";
}

export function useBucketVersioningController({
  contextId,
  bucketName,
  cephAdmin,
  cephAdminTenant,
  enabled,
  endpointId,
}: UseBucketVersioningControllerOptions) {
  const [status, setStatus] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyStatus = useCallback((next?: string | null) => {
    const normalized = next?.trim() || null;
    setStatus(normalized);
    setDraftEnabled(statusIsEnabled(normalized));
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyStatus(null);
      setLoadError(null);
      setSaveError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketVersioning(endpointId, bucketName, cephAdminTenant)
          : { status: null }
        : await getBucketVersioning(contextId, bucketName);
      applyStatus(data.status ?? null);
    } catch (loadFailure) {
      applyStatus(null);
      setLoadError(
        extractApiError(loadFailure, "Unable to load bucket versioning."),
      );
    } finally {
      setLoading(false);
    }
  }, [contextId, applyStatus, bucketName, cephAdmin, cephAdminTenant, enabled, endpointId]);

  const updateDraft = (value: boolean) => {
    setDraftEnabled(value);
    setSaveError(null);
  };

  const markEnabled = () => {
    applyStatus("Enabled");
    setLoadError(null);
    setSaveError(null);
  };

  const save = async (disableBlocked: boolean) => {
    if (!bucketName || !enabled || loading || loadError) return;
    if (disableBlocked && !draftEnabled) {
      setSaveError(
        "Versioning cannot be disabled while Object Lock is enabled.",
      );
      return;
    }
    const currentlyEnabled = statusIsEnabled(status);
    if (draftEnabled === currentlyEnabled) return;

    setSaving(true);
    setSaveError(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await setCephAdminBucketVersioning(
          endpointId,
          bucketName,
          draftEnabled,
          cephAdminTenant,
        );
      } else {
        await setBucketVersioning(contextId, bucketName, draftEnabled);
      }
      applyStatus(draftEnabled ? "Enabled" : "Suspended");
    } catch (saveFailure) {
      setSaveError(
        extractApiError(saveFailure, "Failed to update versioning."),
      );
    } finally {
      setSaving(false);
    }
  };

  const normalizedStatus = (status ?? "").trim().toLowerCase();
  const isEnabled = normalizedStatus === "enabled";
  return {
    dirty: draftEnabled !== isEnabled,
    draftEnabled,
    isEnabled,
    isSuspended: normalizedStatus === "suspended",
    load,
    loadError,
    loading,
    markEnabled,
    save,
    saveError,
    saving,
    status,
    updateDraft,
  };
}
