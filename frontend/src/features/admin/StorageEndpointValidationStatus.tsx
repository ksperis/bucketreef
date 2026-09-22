/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type {
  StorageEndpointAdminOpsPermissions,
  StorageEndpointCredentialCheck,
  StorageEndpointCredentialCheckStatus,
  StorageEndpointHttpCheck,
} from "../../api/storageEndpoints";
import UiBadge from "../../components/ui/UiBadge";

type CredentialCheckViewStatus = StorageEndpointCredentialCheckStatus | "checking";

export function hasAccountProvisioningPermissions(
  permissions?: StorageEndpointAdminOpsPermissions | null,
): boolean {
  return Boolean(
    permissions?.users_read &&
      permissions.users_write &&
      permissions.accounts_read &&
      permissions.accounts_write,
  );
}

export function AdminOpsPermissionsBadges({
  permissions,
}: {
  permissions?: StorageEndpointAdminOpsPermissions | null;
}) {
  if (!permissions) return null;
  const usersReady = permissions.users_read && permissions.users_write;
  const accountsReady = permissions.accounts_read && permissions.accounts_write;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <UiBadge tone={usersReady ? "success" : "danger"} role="status">
        {usersReady ? "✓ Users cap · read/write" : "× Users cap · missing read/write"}
      </UiBadge>
      <UiBadge tone={accountsReady ? "success" : "danger"} role="status">
        {accountsReady ? "✓ Accounts cap · read/write" : "× Accounts cap · missing read/write"}
      </UiBadge>
      <UiBadge
        tone={permissions.buckets_write ? "success" : "neutral"}
        role="status"
        title={
          permissions.buckets_write
            ? "buckets=write is available for delegated bucket quota changes."
            : "Optional: buckets=write is needed only for delegated bucket quota changes."
        }
      >
        {permissions.buckets_write ? "✓ Bucket quotas · available" : "Bucket quotas · optional cap not granted"}
      </UiBadge>
    </span>
  );
}

export function SupervisionValidationBadges({
  metrics,
  usage,
  metricsError,
  usageError,
}: {
  metrics: boolean;
  usage: boolean;
  metricsError?: string | null;
  usageError?: string | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <UiBadge
        tone={metrics ? "success" : "danger"}
        role="status"
        title={metricsError ?? undefined}
      >
        {metrics ? "✓ Bucket stats · available" : "× Bucket stats · unavailable"}
      </UiBadge>
      <UiBadge
        tone={usage ? "success" : "warning"}
        role="status"
        title={usageError ?? undefined}
      >
        {usage ? "✓ Usage data · available" : "! Usage data · no values"}
      </UiBadge>
    </span>
  );
}

export function CredentialStatusBadge({
  status,
  message,
}: {
  status: CredentialCheckViewStatus;
  message?: string | null;
}) {
  const presentation = {
    checking: { tone: "info" as const, label: "Checking access…", symbol: null },
    valid: { tone: "success" as const, label: "Access validated", symbol: "✓" },
    denied: { tone: "danger" as const, label: "Access rejected", symbol: "×" },
    unavailable: { tone: "warning" as const, label: "Check unavailable", symbol: "!" },
    incomplete: { tone: "warning" as const, label: "Complete both keys", symbol: "!" },
    not_configured: { tone: "neutral" as const, label: "Not configured", symbol: null },
  }[status];

  return (
    <UiBadge
      tone={presentation.tone}
      title={message ?? presentation.label}
      role="status"
      aria-label={message ? `${presentation.label}. ${message}` : presentation.label}
      className="shrink-0 gap-1"
    >
      {status === "checking" ? (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border border-current border-r-transparent"
        />
      ) : presentation.symbol ? (
        <span aria-hidden="true">{presentation.symbol}</span>
      ) : null}
      {presentation.label}
    </UiBadge>
  );
}

export function EndpointHttpStatusBadge({
  checking,
  check,
}: {
  checking: boolean;
  check?: StorageEndpointHttpCheck | null;
}) {
  if (checking) {
    return (
      <UiBadge tone="info" role="status">
        Checking endpoint…
      </UiBadge>
    );
  }
  if (!check || check.status === "not_checked") return null;
  if (check.status === "valid") {
    const label = check.status_code
      ? `Endpoint reachable · HTTP ${check.status_code}`
      : "Endpoint reachable";
    return (
      <UiBadge tone="success" role="status" title={check.message ?? label}>
        ✓ {label}
      </UiBadge>
    );
  }
  return (
    <UiBadge
      tone="danger"
      role="status"
      title={check.message ?? "Endpoint unavailable"}
    >
      × Endpoint unavailable
    </UiBadge>
  );
}

export function resolveCredentialCheckView({
  accessKey,
  secretKey,
  storedAccessKey,
  hasStoredSecret,
  endpointReady,
  checking,
  check,
  incompleteMessage,
}: {
  accessKey: string;
  secretKey: string;
  storedAccessKey?: string | null;
  hasStoredSecret: boolean;
  endpointReady: boolean;
  checking: boolean;
  check: StorageEndpointCredentialCheck;
  incompleteMessage: string;
}): { status: CredentialCheckViewStatus; message?: string | null } | null {
  const normalizedAccessKey = accessKey.trim();
  const normalizedSecretKey = secretKey.trim();
  if (!normalizedAccessKey && !normalizedSecretKey) return null;

  const canReuseStoredSecret = Boolean(
    hasStoredSecret &&
      normalizedAccessKey &&
      normalizedAccessKey === (storedAccessKey ?? "").trim(),
  );
  if (!normalizedAccessKey || (!normalizedSecretKey && !canReuseStoredSecret)) {
    return { status: "incomplete", message: incompleteMessage };
  }
  if (!endpointReady) {
    return {
      status: "incomplete",
      message: "Enter the endpoint URL before checking access.",
    };
  }
  if (checking || check.status === "not_configured") {
    return {
      status: "checking",
      message: "BucketReef is checking these credentials against RGW.",
    };
  }
  return check;
}
