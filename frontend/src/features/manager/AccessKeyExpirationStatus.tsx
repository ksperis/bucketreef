/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { ListBadge } from "../../components/list/ListControls";
import { formatLocalDateTime } from "../../utils/dateTime";

type ExpirationState = "scheduled" | "retrying" | "enforced" | "blocked" | null | undefined;

export function accessKeyExpirationIsPast(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
}

type Props = {
  expiresAt?: string | null;
  state?: ExpirationState;
  error?: string | null;
};

export default function AccessKeyExpirationStatus({ expiresAt, state, error }: Props) {
  if (!expiresAt) return <span>—</span>;
  const past = accessKeyExpirationIsPast(expiresAt);
  const label = state === "enforced"
    ? "Expired"
    : state === "retrying"
      ? "Retrying"
      : state === "blocked"
        ? "Action required"
        : past
          ? "Due"
          : "Scheduled";
  const tone = state === "enforced"
    ? "neutral"
    : state === "retrying" || state === "blocked" || past
      ? "warning"
      : "info";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <ListBadge tone={tone} title={error || undefined}>{label}</ListBadge>
        <span>{formatLocalDateTime(expiresAt)}</span>
      </div>
      {error && (state === "retrying" || state === "blocked") && (
        <div className="mt-0.5 line-clamp-2 text-sm text-[var(--ui-text-muted)]" title={error}>{error}</div>
      )}
    </div>
  );
}
