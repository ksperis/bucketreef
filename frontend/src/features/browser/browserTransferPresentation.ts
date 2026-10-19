/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserSettings, BucketCorsStatus } from "../../api/browserContracts";
import {
  DEFAULT_DIRECT_DOWNLOAD_PARALLELISM,
  DEFAULT_DIRECT_UPLOAD_PARALLELISM,
  DEFAULT_OTHER_OPERATIONS_PARALLELISM,
  DEFAULT_PROXY_DOWNLOAD_PARALLELISM,
  DEFAULT_PROXY_UPLOAD_PARALLELISM,
} from "./browserConstants";
import { clampParallelism } from "./browserUtils";
import { defaultBrowserText, type BrowserTextFn } from "./browserI18n";
import type { BrowserUploadMode } from "./sseBrowserLogic";

const STS_REFRESH_WINDOW_MS = 2 * 60 * 1000;
export const CORS_DIRECT_TRANSFER_WARNING =
  "Direct download/upload is not allowed on this bucket.";

type TransferParallelismSettings = Pick<
  BrowserSettings,
  | "direct_upload_parallelism"
  | "proxy_upload_parallelism"
  | "direct_download_parallelism"
  | "proxy_download_parallelism"
  | "other_operations_parallelism"
>;

type BrowserTransferParallelism = {
  upload: number;
  download: number;
  otherOperations: number;
};

export type BrowserTransferAccessBadge = {
  label: string;
  title: string;
  tone: "danger" | "warning" | "info" | "success";
  indicatorClassName: string;
};

type BrowserCorsAvailability = "enabled" | "disabled" | "unknown";

export function resolveBrowserCorsAvailability(
  status: BucketCorsStatus | null | undefined,
): BrowserCorsAvailability {
  if (!status || status.error) return "unknown";
  return status.enabled ? "enabled" : "disabled";
}

export function resolveBrowserTransferParallelism(
  settings: TransferParallelismSettings | null | undefined,
  useProxyTransfers: boolean,
): BrowserTransferParallelism {
  const uploadFallback = useProxyTransfers
    ? DEFAULT_PROXY_UPLOAD_PARALLELISM
    : DEFAULT_DIRECT_UPLOAD_PARALLELISM;
  const downloadFallback = useProxyTransfers
    ? DEFAULT_PROXY_DOWNLOAD_PARALLELISM
    : DEFAULT_DIRECT_DOWNLOAD_PARALLELISM;
  const uploadValue = useProxyTransfers
    ? settings?.proxy_upload_parallelism
    : settings?.direct_upload_parallelism;
  const downloadValue = useProxyTransfers
    ? settings?.proxy_download_parallelism
    : settings?.direct_download_parallelism;
  const otherOperationsValue =
    settings?.other_operations_parallelism ??
    DEFAULT_OTHER_OPERATIONS_PARALLELISM;

  return {
    upload: clampParallelism(uploadValue ?? uploadFallback, uploadFallback),
    download: clampParallelism(
      downloadValue ?? downloadFallback,
      downloadFallback,
    ),
    otherOperations: clampParallelism(
      otherOperationsValue,
      DEFAULT_OTHER_OPERATIONS_PARALLELISM,
    ),
  };
}

export function isStsCredentialsExpiring(
  expiration: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!expiration) return true;
  const expiresAt = new Date(expiration).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - nowMs <= STS_REFRESH_WINDOW_MS;
}

type BrowserTransferWarningsInput = {
  warningMessage: string | null;
  corsFixError: string | null;
  stsCredentialsError: string | null;
  corsEnabled: boolean | null;
  proxyAllowed: boolean;
  uploadUnavailable: boolean;
};

export function buildBrowserTransferWarnings({
  warningMessage,
  corsFixError,
  stsCredentialsError,
  corsEnabled,
  proxyAllowed,
  uploadUnavailable,
}: BrowserTransferWarningsInput, text?: BrowserTextFn): string[] {
  const items = [warningMessage, corsFixError, stsCredentialsError].filter(
    (item): item is string => Boolean(item),
  );
  if (corsEnabled === false && !proxyAllowed) {
    items.push(text ? text("Proxy transfers are disabled in settings.") : "Proxy transfers are disabled in settings.");
  } else if (uploadUnavailable) {
    items.push(
      text
        ? text("Uploads are unavailable with the current Browser transfer settings.")
        : "Uploads are unavailable with the current Browser transfer settings.",
    );
  }
  return items;
}

export function resolveDirectCredentialStsTooltip(
  contextKind: "connection" | "s3_user" | null,
  text?: BrowserTextFn,
): string {
  if (contextKind === "connection") {
    const message = "STS is not available for S3 connections. Presigned URLs are used instead.";
    return text ? text(message) : message;
  }
  if (contextKind === "s3_user") {
    const message = "STS is not available for S3 users. Presigned URLs are used instead.";
    return text ? text(message) : message;
  }
  return "";
}

type BrowserTransferAccessBadgeInput = {
  hasContext: boolean;
  uploadMode: BrowserUploadMode;
  sseActive: boolean;
  hasStsCredentials: boolean;
  stsExpirationLabel: string;
  directCredentialStsTooltip: string;
  text?: BrowserTextFn;
};

export function resolveBrowserTransferAccessBadge({
  hasContext,
  uploadMode,
  sseActive,
  hasStsCredentials,
  stsExpirationLabel,
  directCredentialStsTooltip,
  text,
}: BrowserTransferAccessBadgeInput): BrowserTransferAccessBadge | null {
  const tr = text ?? defaultBrowserText;
  if (!hasContext) return null;
  if (uploadMode === "unavailable") {
    return {
      label: tr("Unavailable"),
      title: tr("Uploads are unavailable with the current Browser transfer settings."),
      tone: "danger",
      indicatorClassName:
        "border-rose-200/70 bg-rose-200/60 dark:border-rose-400/40 dark:bg-rose-400/25",
    };
  }
  if (uploadMode === "proxy") {
    return {
      label: tr("Proxy"),
      title: tr("Upload mode: Backend proxy transfers are active."),
      tone: "info",
      indicatorClassName:
        "border-amber-200/70 bg-amber-200/60 dark:border-amber-400/40 dark:bg-amber-400/25",
    };
  }
  if (sseActive) {
    return {
      label: "SSE-C",
      title: tr("Download/Upload mode: SSE-C customer key is active for this bucket."),
      tone: "info",
      indicatorClassName:
        "border-sky-200/70 bg-sky-200/60 dark:border-sky-400/40 dark:bg-sky-400/25",
    };
  }
  if (uploadMode === "sts") {
    return {
      label: "STS",
      title: hasStsCredentials && stsExpirationLabel
        ? tr("Upload mode: STS credentials active (expires at {date}).", { date: stsExpirationLabel })
        : tr("Upload mode: STS signing is active."),
      tone: "success",
      indicatorClassName:
        "border-emerald-200/70 bg-emerald-200/60 dark:border-emerald-400/40 dark:bg-emerald-400/25",
    };
  }
  return {
    label: tr("Presign"),
    title: directCredentialStsTooltip
      ? tr("Upload mode: Presigned URLs are active. {detail}", { detail: directCredentialStsTooltip })
      : tr("Upload mode: Presigned URLs are active."),
    tone: "success",
    indicatorClassName:
      "border-emerald-200/70 bg-emerald-200/60 dark:border-emerald-400/40 dark:bg-emerald-400/25",
  };
}
