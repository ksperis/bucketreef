import { describe, expect, it } from "vitest";
import { matchRoutes, type RouteObject } from "react-router-dom";

import { createAppRoutes } from "./router";

function joinRoutePath(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  const normalizedBase = base === "/" ? "" : base;
  return `${normalizedBase}/${path}`.replace(/\/+/g, "/");
}

function collectRoutePaths(routes: RouteObject[], base = ""): string[] {
  return routes.flatMap((route) => {
    const current = route.path ? joinRoutePath(base || "/", route.path) : base || "/";
    const own = route.index ? [`${current}#index`] : route.path ? [current] : [];
    return [...own, ...collectRoutePaths(route.children ?? [], current)];
  });
}

describe("route snapshot", () => {
  it("preserves the public frontend route contract", () => {
    expect(collectRoutePaths(createAppRoutes())).toEqual([
      "/#index",
      "/admin",
      "/admin#index",
      "/admin/onboarding",
      "/admin/profile",
      "/admin/s3-accounts",
      "/admin/s3-users",
      "/admin/s3-connections",
      "/admin/s3-users/:userId/keys",
      "/admin/storage-endpoints",
      "/admin/storage-endpoints/:endpointId",
      "/admin/endpoint-status",
      "/admin/endpoint-status/:endpointId",
      "/admin/users",
      "/admin/groups",
      "/admin/identity-security",
      "/admin/audit",
      "/admin/metrics",
      "/admin/portal-requests",
      "/admin/billing",
      "/admin/usage-history",
      "/admin/production-readiness",
      "/admin/general-settings",
      "/admin/authentication-settings",
      "/admin/authentication-settings/oidc/new",
      "/admin/authentication-settings/oidc/providers/:providerId",
      "/admin/authentication-settings/ldap/new",
      "/admin/authentication-settings/ldap/providers/:providerId",
      "/admin/manager-settings",
      "/admin/portal-settings",
      "/admin/browser-settings",
      "/admin/webhook-settings",
      "/admin/webhook-settings/new",
      "/admin/webhook-settings/:endpointId",
      "/admin/key-rotation",
      "/admin/api-tokens",
      "/ceph-admin",
      "/ceph-admin#index",
      "/ceph-admin/profile",
      "/ceph-admin/metrics",
      "/ceph-admin/accounts",
      "/ceph-admin/users",
      "/ceph-admin/buckets",
      "/ceph-admin/buckets/:bucketName",
      "/ceph-admin/browser",
      "/storage-ops",
      "/storage-ops#index",
      "/storage-ops/profile",
      "/storage-ops/buckets",
      "/storage-ops/buckets/:bucketName",
      "/manager",
      "/manager#index",
      "/manager/profile",
      "/manager/buckets",
      "/manager/buckets/:bucketName",
      "/manager/browser",
      "/manager/metrics",
      "/manager/users",
      "/manager/users/:userName/keys",
      "/manager/users/:userName/policies",
      "/manager/groups",
      "/manager/groups/:groupName/policies",
      "/manager/groups/:groupName/users",
      "/manager/roles",
      "/manager/roles/:roleName/policies",
      "/manager/iam/policies",
      "/manager/topics",
      "/manager/ceph/keys",
      "/manager/bucket-compare",
      "/manager/bucket-integrity",
      "/manager/bucket-purge",
      "/manager/feature-rules",
      "/manager/migrations",
      "/manager/migrations/new",
      "/manager/migrations/:migrationId",
      "/browser",
      "/browser#index",
      "/browser/profile",
      "/portal",
      "/portal#index",
      "/portal/profile",
      "/portal/storage-spaces",
      "/portal/storage-spaces/:spaceId",
      "/portal/access-keys",
      "/portal/shares",
      "/portal/shares/:userId",
      "/portal/requests",
      "/portal/history",
      "/portal/usage",
      "/portal/settings",
      "/login",
      "/setup/first-admin",
      "/oidc/:provider/callback",
      "/unauthorized",
      "/*",
    ]);
  });

  it.each(["/admin/accounts", "/admin/accounts/", "/admin/accounts?search=helios"])(
    "uses the unknown-route fallback for the removed alias %s",
    (path) => {
      const matches = matchRoutes(createAppRoutes(), path);
      expect(matches?.at(-1)?.route.path).toBe("*");
    },
  );

  it.each(["/profile", "/profile/", "/profile?tab=security"])(
    "uses the unknown-route fallback for the removed profile alias %s",
    (path) => {
      const matches = matchRoutes(createAppRoutes(), path);
      expect(matches?.at(-1)?.route.path).toBe("*");
    },
  );

  it("keeps the canonical Admin and distinct Ceph Admin account routes", () => {
    const routes = createAppRoutes();
    expect(matchRoutes(routes, "/admin/s3-accounts")?.at(-1)?.route.path).toBe("s3-accounts");
    expect(matchRoutes(routes, "/ceph-admin/accounts")?.at(-1)?.route.path).toBe("accounts");
  });
});
