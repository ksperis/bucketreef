/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { isValidElement } from "react";
import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { createAppRoutes } from "./router";

describe("shared profile route mounts", () => {
  it("keeps the same profile component in all six workspace route trees", () => {
    const routes = createAppRoutes();
    const leaves = ["admin", "browser", "manager", "portal", "ceph-admin", "storage-ops"].map(workspace => {
      const matches = matchRoutes(routes, `/${workspace}/profile?tab=security`);
      expect(matches).not.toBeNull();
      const route = matches!.at(-1)!.route;
      expect(route.path).toBe("profile");
      expect(isValidElement(route.element)).toBe(true);
      return isValidElement(route.element) ? route.element.type : null;
    });
    expect(new Set(leaves).size).toBe(1);
  });
});
