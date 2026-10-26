import type { Page } from "@playwright/test";
import type { AuthUser, CurrentSessionResponse } from "../../src/api/auth";
import type { MockRule } from "./types";

type RegisteredApiMocks = {
  assertNoUnmatched: () => void;
};

export async function registerApiMocks(
  page: Page,
  rules: MockRule[],
  scenarioId: string,
  user: AuthUser | null = null,
): Promise<RegisteredApiMocks> {
  const unmatchedRequests: string[] = [];
  const state = new Map<string, unknown>();
  const now = Date.now();
  const session: CurrentSessionResponse | null = user
    ? {
        authenticated: true,
        user,
        session: null,
        auth_session: {
          id: `docs-${scenarioId}`,
          principal_type: "user",
          auth_type: "password",
          created_at: new Date(now).toISOString(),
          last_activity_at: new Date(now).toISOString(),
          mfa_verified_at: null,
          ip_address: null,
          user_agent: null,
          revoked_at: null,
          revoke_reason: null,
          current: true,
          user_id: user.id,
          s3_session_id: null,
          idle_expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
          absolute_expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        },
      }
    : null;
  const effectiveRules: MockRule[] = user
    ? [
        ...rules,
        { id: "current-user", method: "GET", path: /^\/users\/me$/, body: user },
        {
          id: "current-auth-session",
          method: "GET",
          path: /^\/auth\/session$/,
          body: session,
        },
        { id: "login-oidc-providers", path: /^\/auth\/oidc\/providers$/, body: [] },
        { id: "login-ldap-providers", path: /^\/auth\/ldap\/providers$/, body: [] },
      ]
    : rules;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const path = url.pathname.slice(4);
    const requestBodyText = request.postData() ?? "";

    const rule = effectiveRules.find((candidate) => {
      if (candidate.method && candidate.method !== method) return false;
      return candidate.path.test(path);
    });

    if (!rule) {
      const signature = `${method} ${path}`;
      unmatchedRequests.push(signature);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: `No mock configured for ${signature} (scenario: ${scenarioId})`,
        }),
      });
      return;
    }

    const payload =
      typeof rule.body === "function"
        ? rule.body({ url, method, requestBodyText, state })
        : rule.body;

    if (rule.delayMs && rule.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
    }

    const status = rule.status ?? 200;
    if (payload === undefined || status === 204) {
      await route.fulfill({ status: status === 200 ? 204 : status });
      return;
    }

    const contentType = rule.contentType ?? "application/json";
    await route.fulfill({
      status,
      contentType,
      body:
        typeof payload === "string" && contentType !== "application/json"
          ? payload
          : JSON.stringify(payload),
    });
  });

  return {
    assertNoUnmatched: () => {
      if (unmatchedRequests.length === 0) return;
      const unique = Array.from(new Set(unmatchedRequests)).sort();
      throw new Error(
        `Unmatched API routes in scenario '${scenarioId}':\n${unique.join("\n")}`
      );
    },
  };
}
