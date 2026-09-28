import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequireCephAdminFeature, RequireStorageOpsFeature } from "./routerGuards";
import type { SessionUser } from "./utils/workspaces";

const mocks = vi.hoisted(() => ({
  user: null as SessionUser | null,
}));

vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({ authenticated: true, loading: false, user: mocks.user }),
}));

vi.mock("./components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    loading: false,
    generalSettings: {
      ceph_admin_enabled: true,
      storage_ops_enabled: true,
    },
  }),
}));

function effectiveAccess(overrides: Partial<NonNullable<SessionUser["effective_access"]>> = {}) {
  return {
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
      feature_rules: false,
    },
    browser_advanced_features_enabled: false,
    account_links: [],
    s3_user_details: [],
    s3_connection_details: [],
    ...overrides,
  };
}

function renderGuard(guard: "storage-ops" | "ceph-admin") {
  const Guard = guard === "storage-ops" ? RequireStorageOpsFeature : RequireCephAdminFeature;
  const path = `/${guard}`;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Guard />}>
          <Route path={path} element={<h1>Authorized workspace</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("privileged workspace route guards", () => {
  beforeEach(() => {
    mocks.user = null;
  });

  it("accepts Storage Ops access inherited from a UI group", async () => {
    mocks.user = {
      id: 3,
      role: "ui_user",
      can_access_storage_ops: false,
      effective_access: effectiveAccess({ can_access_storage_ops: true }),
    };

    renderGuard("storage-ops");

    expect(await screen.findByRole("heading", { name: "Authorized workspace" })).toBeInTheDocument();
  });

  it("accepts inherited Ceph Admin access only for an admin-like role", async () => {
    mocks.user = {
      id: 4,
      role: "ui_admin",
      can_access_ceph_admin: false,
      effective_access: effectiveAccess({ can_access_ceph_admin: true }),
    };

    renderGuard("ceph-admin");

    expect(await screen.findByRole("heading", { name: "Authorized workspace" })).toBeInTheDocument();
  });

  it("keeps Ceph Admin unavailable to a non-admin even when a group carries the raw flag", async () => {
    mocks.user = {
      id: 5,
      role: "ui_user",
      can_access_ceph_admin: false,
      effective_access: effectiveAccess({ can_access_ceph_admin: true }),
    };

    renderGuard("ceph-admin");

    expect(await screen.findByRole("heading", { name: "This passage is reserved." })).toBeInTheDocument();
  });
});
