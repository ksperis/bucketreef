/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import {
  createBrowserBucket,
  ensureBrowserBucketCors,
} from "../../api/browserBuckets";
import type { BucketCorsStatus } from "../../api/browserContracts";
import { extractApiError } from "../../utils/apiError";
import {
  isValidS3BucketName,
  normalizeS3BucketName,
} from "../../utils/s3BucketName";
import { useBrowserI18n } from "./browserI18n";

const INVALID_BUCKET_NAME_MESSAGE =
  "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.";

type UseBrowserCreateBucketOptions = {
  contextIdForApi: S3ExecutionContextSelector;
  currentBucketName: string;
  enabled: boolean;
  hasContext: boolean;
  requestOptions?: BrowserRequestOptions;
  uiOrigin?: string | null;
  onCreated: (bucketName: string) => Promise<void> | void;
  setCorsError: (message: string | null) => void;
  setCorsStatus: (status: BucketCorsStatus) => void;
  setStatusMessage: (message: string) => void;
};

export function useBrowserCreateBucket({
  contextIdForApi,
  currentBucketName,
  enabled,
  hasContext,
  requestOptions,
  uiOrigin,
  onCreated,
  setCorsError,
  setCorsStatus,
  setStatusMessage,
}: UseBrowserCreateBucketOptions) {
  const { text } = useBrowserI18n();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [versioning, setVersioning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setVersioning(false);
    setError(null);
  }, []);

  const open = useCallback(() => {
    if (!enabled) return;
    reset();
    setShowModal(true);
  }, [enabled, reset]);

  const close = useCallback(() => {
    if (loading) return;
    setShowModal(false);
    reset();
  }, [loading, reset]);

  const updateName = (value: string) => {
    setName(value);
    if (error) setError(null);
  };

  const submit = async () => {
    if (!hasContext || !enabled || loading) return;
    const normalizedName = normalizeS3BucketName(name);
    if (!normalizedName) {
      setError(text("Bucket name is required."));
      return;
    }
    if (!isValidS3BucketName(normalizedName)) {
      setError(text(INVALID_BUCKET_NAME_MESSAGE));
      return;
    }
    setLoading(true);
    setError(null);
    setCorsError(null);
    try {
      await createBrowserBucket(contextIdForApi, normalizedName, {
        versioning,
        ...requestOptions,
      });
      let corsApplied = false;
      if (uiOrigin) {
        try {
          const status = await ensureBrowserBucketCors(
            contextIdForApi,
            normalizedName,
            uiOrigin,
            requestOptions,
          );
          corsApplied = status.enabled;
          if (currentBucketName === normalizedName) {
            setCorsStatus(status);
          }
          if (!status.enabled && status.error) {
            setCorsError(status.error);
          }
        } catch {
          setCorsError(text("Bucket created, but unable to auto-apply CORS."));
        }
      }
      setShowModal(false);
      reset();
      setStatusMessage(
        uiOrigin
          ? corsApplied
            ? text("Bucket {name} created with CORS enabled.", {
                name: normalizedName,
              })
            : text("Bucket {name} created. CORS could not be auto-enabled.", {
                name: normalizedName,
              })
          : text("Bucket {name} created.", { name: normalizedName }),
      );
      await onCreated(normalizedName);
    } catch (submitError) {
      setError(extractApiError(submitError, text("Unable to create bucket.")));
    } finally {
      setLoading(false);
    }
  };

  return {
    showModal,
    name,
    versioning,
    loading,
    error,
    isNameValid: !name || isValidS3BucketName(name),
    invalidNameMessage: text(INVALID_BUCKET_NAME_MESSAGE),
    open,
    updateName,
    setVersioning,
    submit,
    close,
  };
}
