import type { Page, Request, Route } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { portalUser } from "./fixtures/users";
import { registerApiMocks } from "./mockApi";

function mockPage() {
  let handler: Parameters<Page["route"]>[1];
  const page = {
    route: vi.fn(async (_pattern: string, callback: typeof handler) => {
      handler = callback;
    }),
  } as unknown as Page;

  const dispatch = async (path: string, method = "GET", body: string | null = null) => {
    const request = {
      url: () => `http://localhost:4173${path}`,
      method: () => method,
      postData: () => body,
    } as Request;
    const fulfill = vi.fn();
    const continueRequest = vi.fn();
    const route = {
      request: () => request,
      fulfill,
      continue: continueRequest,
    } as unknown as Route;
    await handler(route, request);
    return { fulfill, continueRequest };
  };
  return { page, dispatch };
}

describe("documentation API mocks", () => {
  afterEach(() => vi.useRealTimers());

  it("restores the explicit user through a complete, non-expired session response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-02-03T10:00:00Z"));
    const { page, dispatch } = mockPage();
    const registry = await registerApiMocks(page, [], "portal", portalUser);

    const session = await dispatch("/api/auth/session");
    expect(JSON.parse(session.fulfill.mock.calls[0][0].body)).toEqual({
      authenticated: true,
      user: portalUser,
      session: null,
      auth_session: {
        id: "docs-portal",
        auth_type: "password",
        mfa_verified_at: null,
        idle_expires_at: "2030-02-03T11:00:00.000Z",
        absolute_expires_at: "2030-02-04T10:00:00.000Z",
      },
    });
    const currentUser = await dispatch("/api/users/me");
    expect(JSON.parse(currentUser.fulfill.mock.calls[0][0].body)).toEqual(portalUser);
    expect(() => registry.assertNoUnmatched()).not.toThrow();
  });

  it("does not infer a session from a rule name", async () => {
    const { page, dispatch } = mockPage();
    const registry = await registerApiMocks(page, [
      { id: "current-user", path: /^\/users\/me$/, body: portalUser },
    ], "anonymous");

    const session = await dispatch("/api/auth/session");
    expect(session.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
    expect(() => registry.assertNoUnmatched()).toThrow("GET /auth/session");
  });

  it("keeps explicit scenario overrides ahead of default session responses", async () => {
    const { page, dispatch } = mockPage();
    const registry = await registerApiMocks(page, [
      { id: "expired-session", path: /^\/auth\/session$/, status: 401, body: { detail: "Session expired" } },
    ], "expired", portalUser);

    const session = await dispatch("/api/auth/session");
    expect(session.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    expect(() => registry.assertNoUnmatched()).not.toThrow();
  });

  it("passes Vite API source modules through without treating them as backend calls", async () => {
    const { page, dispatch } = mockPage();
    const registry = await registerApiMocks(page, [], "source-modules");
    const source = await dispatch("/src/api/users.ts");

    expect(source.continueRequest).toHaveBeenCalledOnce();
    expect(source.fulfill).not.toHaveBeenCalled();
    expect(() => registry.assertNoUnmatched()).not.toThrow();
  });

  it("passes the real query, HTTP method, and request body to a matching response callback", async () => {
    const { page, dispatch } = mockPage();
    const registry = await registerApiMocks(page, [{
      id: "echo",
      path: /^\/echo$/,
      method: "POST",
      body: ({ url, method, requestBodyText }) => ({
        key: url.searchParams.get("key"), method, payload: JSON.parse(requestBodyText),
      }),
    }], "echo");
    const response = await dispatch("/api/echo?key=reports%2Fannual+report.csv", "POST", '{"page":2}');

    expect(JSON.parse(response.fulfill.mock.calls[0][0].body)).toEqual({
      key: "reports/annual report.csv", method: "POST", payload: { page: 2 },
    });
    expect(() => registry.assertNoUnmatched()).not.toThrow();
  });

  it("returns no body for empty successful responses", async () => {
    const { page, dispatch } = mockPage();
    await registerApiMocks(page, [{ id: "empty", path: /^\/empty$/, body: undefined }], "empty");
    const response = await dispatch("/api/empty");
    expect(response.fulfill).toHaveBeenCalledWith({ status: 204 });
  });
});
