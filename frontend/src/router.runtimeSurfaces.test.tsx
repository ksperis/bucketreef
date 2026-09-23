import type { RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_SURFACES } from "./api/appSettings";
import { createAppRoutes } from "./router";

function declaresPath(routes: RouteObject[], path: string): boolean {
  return routes.some((route) => route.path === path || (route.children ? declaresPath(route.children, path) : false));
}


describe("runtime surface routes", () => {
  it("omits administration routes from a user-facing instance", () => {
    const routes = createAppRoutes({
      ...DEFAULT_RUNTIME_SURFACES,
      admin: false,
      ceph_admin: false,
      storage_ops: false,
      manager: true,
      portal: true,
      browser: true,
    });

    expect(declaresPath(routes, "/admin")).toBe(false);
    expect(declaresPath(routes, "/ceph-admin")).toBe(false);
    expect(declaresPath(routes, "/storage-ops")).toBe(false);
    expect(declaresPath(routes, "/manager")).toBe(true);
    expect(declaresPath(routes, "/portal")).toBe(true);
    expect(declaresPath(routes, "/browser")).toBe(true);
  });

  it("omits user-facing routes from an administration instance", () => {
    const routes = createAppRoutes({
      ...DEFAULT_RUNTIME_SURFACES,
      admin: true,
      ceph_admin: true,
      storage_ops: true,
      manager: false,
      portal: false,
      browser: false,
    });

    expect(declaresPath(routes, "/admin")).toBe(true);
    expect(declaresPath(routes, "/ceph-admin")).toBe(true);
    expect(declaresPath(routes, "/storage-ops")).toBe(true);
    expect(declaresPath(routes, "/manager")).toBe(false);
    expect(declaresPath(routes, "/portal")).toBe(false);
    expect(declaresPath(routes, "/browser")).toBe(false);
    expect(declaresPath(routes, "browser")).toBe(false);
  });
});
