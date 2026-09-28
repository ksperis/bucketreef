/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import client, {
  API_REQUEST_TIMEOUT_MS,
  AUTH_REFRESH_TIMEOUT_MS,
  buildApiRequestHeaders,
  buildApiFetchHeaders,
  buildApiUrl,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  timeoutForRequestProfile,
} from "./client";
import { CLIENT_STORAGE_KEYS } from "../utils/clientStorage";
import { readStoredUser, setSessionUserCache } from "../utils/workspaces";

beforeEach(() => {
  localStorage.clear();
  setSessionUserCache(null);
  document.cookie = "csrf_token=; Max-Age=0; path=/";
  vi.restoreAllMocks();
});

describe("API request profiles", () => {
  it("keeps business requests unbounded and explicit profiles stable", () => {
    expect(API_REQUEST_TIMEOUT_MS).toBe(0);
    expect(client.defaults.timeout).toBe(0);
    expect(timeoutForRequestProfile("interactive")).toBe(15_000);
    expect(timeoutForRequestProfile("long_running")).toBe(0);
    expect(AUTH_REFRESH_TIMEOUT_MS).toBe(8_000);
    expect(INTERACTIVE_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("uses cookies and CSRF without permitting a browser Bearer header", async () => {
    document.cookie = "csrf_token=csrf-value; path=/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await client.post("/users/me", { display_name: "Updated" }, {
      headers: { Authorization: "Bearer forbidden-ui-token" },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.credentials).toBe("include");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-value");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("adds CSRF only to unsafe methods", () => {
    document.cookie = "csrf_token=csrf-value; path=/";
    expect(buildApiRequestHeaders("GET").has("X-CSRF-Token")).toBe(false);
    expect(buildApiRequestHeaders("POST").get("X-CSRF-Token")).toBe("csrf-value");
  });

  it("builds authenticated fetch requests from the shared API contract", () => {
    setSessionUserCache({ authType: "s3_session" });
    localStorage.setItem(
      CLIENT_STORAGE_KEYS.s3SessionEndpoint,
      "https://s3.example.test",
    );

    expect(buildApiFetchHeaders({ "X-Request-Scope": "browser" })).toEqual({
      "X-Request-Scope": "browser",
      "X-S3-Endpoint": "https://s3.example.test",
    });
    const url = new URL(buildApiUrl("/browser/buckets/data/download", { key: "a/b", empty: null }));
    expect(url.pathname).toBe("/api/browser/buckets/data/download");
    expect(url.searchParams.get("key")).toBe("a/b");
    expect(url.searchParams.has("empty")).toBe(false);
  });
});


describe("session refresh failures", () => {
  it("preserves the session and original request when refresh is temporarily unavailable", async () => {
    setSessionUserCache({ id: 42, email: "reader@example.test", authType: "password" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(client.get("/users/me")).rejects.toMatchObject({ response: { status: 503 } });
    expect(readStoredUser()?.id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("clears authentication after refresh explicitly denies the session", async () => {
    window.history.replaceState({}, "", "/login");
    setSessionUserCache({ id: 42, authType: "password" });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(client.get("/users/me")).rejects.toMatchObject({ response: { status: 401 } });
    expect(readStoredUser()).toBeNull();
  });
  it("does not retain an invalid session when the retried request is still unauthorized", async () => {
    window.history.replaceState({}, "", "/login");
    setSessionUserCache({ id: 42, authType: "password" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(client.get("/users/me")).rejects.toMatchObject({ response: { status: 401 } });
    expect(readStoredUser()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
