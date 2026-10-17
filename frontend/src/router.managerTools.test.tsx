import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { RequireManagerFeatureRulesTool } from "./router";
import { setSessionUserCache } from "./utils/workspaces";

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireManagerFeatureRulesTool />}>
          <Route path="/manager/feature-rules" element={<h1>Feature rules page</h1>} />
        </Route>
        <Route path="/unauthorized" element={<h1>This passage is reserved.</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function setStoredUser(featureRules: boolean) {
  setSessionUserCache({
    id: 10,
    email: "manager@example.com",
    role: "ui_user",
    effective_access: {
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      can_create_manual_private_connections: false,
      can_provision_managed_private_connections: false,
      has_owned_private_connections: false,
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: featureRules,
      },
      browser_advanced_features_enabled: false,
      account_links: [],
      s3_user_details: [],
      s3_connection_details: [],
    },
  });
}

describe("manager tool routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSessionUserCache(null);
  });

  it("shows restricted access in place without manager tool access", async () => {
    setStoredUser(false);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "This passage is reserved." })).toBeInTheDocument();
  });

  it("allows Feature rules when manager tool access is enabled", async () => {
    setStoredUser(true);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "Feature rules page" })).toBeInTheDocument();
  });

});
