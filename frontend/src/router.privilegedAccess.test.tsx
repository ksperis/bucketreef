import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequireCephAdminFeature, RequireStorageOpsFeature } from "./routerGuards";
import { buildEffectiveUserAccess } from "./test/effectiveAccess";
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
      effective_access: buildEffectiveUserAccess({ can_access_storage_ops: true }),
    };

    renderGuard("storage-ops");

    expect(await screen.findByRole("heading", { name: "Authorized workspace" })).toBeInTheDocument();
  });

  it("accepts inherited Ceph Admin access only for an admin-like role", async () => {
    mocks.user = {
      id: 4,
      role: "ui_admin",
      effective_access: buildEffectiveUserAccess({ can_access_ceph_admin: true }),
    };

    renderGuard("ceph-admin");

    expect(await screen.findByRole("heading", { name: "Authorized workspace" })).toBeInTheDocument();
  });

  it("keeps Ceph Admin unavailable to a non-admin even when a group carries the raw flag", async () => {
    mocks.user = {
      id: 5,
      role: "ui_user",
      effective_access: buildEffectiveUserAccess({ can_access_ceph_admin: true }),
    };

    renderGuard("ceph-admin");

    expect(await screen.findByRole("heading", { name: "This passage is reserved." })).toBeInTheDocument();
  });
});
