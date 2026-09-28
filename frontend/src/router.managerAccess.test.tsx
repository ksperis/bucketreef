import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequireManagerAccess } from "./routerGuards";

const mocks = vi.hoisted(() => ({
  getWorkspaceAccess: vi.fn(),
}));

vi.mock("./api/executionContexts", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));

vi.mock("./auth/SessionProvider", () => ({
  useSession: () => ({
    authenticated: true,
    loading: false,
    user: { id: 7, email: "portal-user@example.com", role: "ui_user" },
  }),
}));

function workspaceAccess(managerAvailable: boolean) {
  return {
    admin: { available: false, context_count: 0 },
    ceph_admin: { available: false, context_count: 0 },
    storage_ops: { available: false, context_count: 0 },
    manager: { available: managerAvailable, context_count: managerAvailable ? 1 : 0 },
    browser: { available: false, context_count: 0 },
    portal: { available: true, context_count: 1 },
    default_workspace: "portal" as const,
  };
}

function renderGuard() {
  render(
    <MemoryRouter initialEntries={["/manager"]}>
      <Routes>
        <Route element={<RequireManagerAccess />}>
          <Route path="/manager" element={<h1>Manager workspace</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireManagerAccess", () => {
  beforeEach(() => {
    mocks.getWorkspaceAccess.mockReset();
  });

  it("renders Manager only when the backend reports an available Manager context", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(workspaceAccess(true));

    renderGuard();

    expect(await screen.findByRole("heading", { name: "Manager workspace" })).toBeInTheDocument();
  });

  it("rejects a Portal-only user before rendering the Manager workspace", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(workspaceAccess(false));

    renderGuard();

    expect(await screen.findByRole("heading", { name: "This passage is reserved." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manager workspace" })).not.toBeInTheDocument();
  });
});
