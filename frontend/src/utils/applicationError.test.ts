import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiError } from "../api/client";
import { classifyApplicationError, isRetryablePageError } from "./applicationError";

describe("application error classification", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    [400, "validation"], [401, "sign_in"], [403, "forbidden"], [404, "not_found"],
    [408, "timeout"], [409, "conflict"], [410, "gone"], [412, "conflict"],
    [413, "too_large"], [419, "session_expired"], [422, "validation"], [429, "rate_limited"],
    [500, "unexpected"], [501, "unsupported"], [502, "unavailable"], [503, "unavailable"], [504, "timeout"], [507, "quota"],
  ])("classifies HTTP %i for both API and router errors", (status, kind) => {
    const response = { status: Number(status), headers: {}, data: {} };
    expect(classifyApplicationError(new ApiError("failure", { response })).kind).toBe(kind);
    expect(classifyApplicationError({ status }).kind).toBe(kind);
  });
  it("never diagnoses maintenance, expiration or offline from a server message", () => {
    const error = new ApiError("maintenance expired offline", { response: { status: 503, headers: {}, data: { detail: "secret" } } });
    expect(classifyApplicationError(error)).toMatchObject({ kind: "unavailable", status: 503 });
    expect(JSON.stringify(classifyApplicationError(error))).not.toContain("secret");
  });
  it("recognizes timeouts and confirms offline only for transport failures", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(classifyApplicationError(new ApiError("timeout", { code: "ETIMEDOUT" })).kind).toBe("timeout");
    expect(classifyApplicationError(new ApiError("Failed to fetch")).kind).toBe("offline");
    expect(classifyApplicationError({ status: 403 }).kind).toBe("forbidden");
  });
  it("distinguishes step-up from other permission denials", () => {
    const response = { status: 403, headers: {}, data: { detail: "Recent WebAuthn verification required" } };
    expect(classifyApplicationError(new ApiError("Forbidden", { response })).kind).toBe("verification_required");
    response.data.detail = "AccessDenied";
    expect(classifyApplicationError(new ApiError("Forbidden", { response })).kind).toBe("forbidden");
  });
  it("takes only allowlisted metadata and supports both Retry-After forms", () => {
    const now = Date.parse("2026-09-28T10:00:00Z");
    const headers = { "Retry-After": "60", "X-Request-Id": "request-1234", authorization: "Bearer secret" };
    const response = { status: 429, headers, data: { token: "secret" } };
    const result = classifyApplicationError(new ApiError("https://secret.invalid?token=secret", { response }), now);
    expect(result).toEqual({ kind: "rate_limited", status: 429, reference: "request-1234", retryAt: now + 60_000 });
    headers["Retry-After"] = "Mon, 28 Sep 2026 10:02:00 GMT";
    expect(classifyApplicationError(new ApiError("", { response }), now).retryAt).toBe(now + 120_000);
    headers["Retry-After"] = "not-a-date";
    headers["X-Request-Id"] = "Bearer secret";
    expect(classifyApplicationError(new ApiError("", { response }), now)).toMatchObject({ retryAt: undefined, reference: undefined });
  });
  it("offers load retries only for temporary or unexpected failures", () => {
    expect(isRetryablePageError("forbidden")).toBe(false);
    expect(isRetryablePageError("conflict")).toBe(false);
    expect(isRetryablePageError("quota")).toBe(false);
    expect(isRetryablePageError("unavailable")).toBe(true);
  });
});
