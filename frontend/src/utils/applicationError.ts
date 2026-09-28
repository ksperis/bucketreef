/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { isApiError } from "../api/client";
import { classifyApiError, isRecentWebAuthnRequired } from "./apiError";

export type ApplicationErrorKind =
  | "not_found" | "gone" | "sign_in" | "session_expired" | "forbidden"
  | "verification_required" | "invalid_link" | "link_expired" | "auth_failed"
  | "unexpected" | "unavailable" | "timeout" | "offline" | "rate_limited"
  | "maintenance" | "feature_disabled" | "unsupported" | "validation"
  | "conflict" | "too_large" | "quota";

type ApplicationError = {
  kind: ApplicationErrorKind;
  status?: number;
  reference?: string;
  retryAt?: number;
};

const HTTP_KINDS: Record<number, ApplicationErrorKind> = {
  400: "validation", 401: "sign_in", 403: "forbidden", 404: "not_found",
  408: "timeout", 409: "conflict", 410: "gone", 412: "conflict",
  413: "too_large", 419: "session_expired", 422: "validation", 429: "rate_limited",
  500: "unexpected", 501: "unsupported", 502: "unavailable", 503: "unavailable",
  504: "timeout", 507: "quota",
};

// Only transport metadata is allowed into the diagnostic panel. Error bodies,
// messages, stacks and URLs may contain credentials or private resource names.
export function classifyApplicationError(error: unknown, now = Date.now()): ApplicationError {
  const api = isApiError(error) ? error : null;
  const candidate = api?.response?.status ?? (
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined
  );
  const status = typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate : undefined;
  const headers = api?.response?.headers;
  const header = (name: string) => Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const rawReference = header("x-request-id") ?? header("x-amz-request-id");
  const reference = typeof rawReference === "string" && /^[a-zA-Z0-9_-]{8,80}$|^[a-fA-F0-9-]{36}$/.test(rawReference)
    ? rawReference : undefined;
  const retryAfter = header("retry-after");
  let retryAt: number | undefined;
  if (typeof retryAfter === "string" && (status === 429 || status === 503)) {
    const value = retryAfter.trim();
    const parsed = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
    if (Number.isFinite(parsed) && parsed > now && parsed - now <= 86_400_000) retryAt = parsed;
  }
  const metadata = { status, reference, retryAt };
  if (isRecentWebAuthnRequired(error)) return { kind: "verification_required", ...metadata };
  if (status) return { kind: HTTP_KINDS[status] ?? "unexpected", ...metadata };
  const failure = classifyApiError(error, "");
  if (failure.kind === "timeout") return { kind: "timeout", ...metadata };
  if (failure.kind === "unavailable") {
    return { kind: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unavailable", ...metadata };
  }
  return { kind: "unexpected", ...metadata };
}

export function isRetryablePageError(kind: ApplicationErrorKind): boolean {
  return ["unexpected", "unavailable", "timeout", "offline", "rate_limited", "maintenance"].includes(kind);
}
