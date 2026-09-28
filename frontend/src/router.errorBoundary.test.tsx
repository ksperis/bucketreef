import { transferableAbortController } from "node:util";
import { Suspense } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./features/auth/LoginPage", () => ({
  default: function MockLoginPage() {
    throw new Error("sensitive route failure");
  },
}));

import { createAppRoutes } from "./router";
import RouteErrorPage from "./features/shared/RouteErrorPage";
import { WorkspaceErrorContext } from "./components/errors/WorkspaceErrorContext";

describe("app route error boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("AbortController", function () { return transferableAbortController(); });
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("replaces the default React Router crash message with the app error page", async () => {
    const router = createMemoryRouter(createAppRoutes(), {
      initialEntries: ["/login"],
    });

    render(
      <Suspense fallback={<div>Loading workspace...</div>}>
        <RouterProvider router={router} />
      </Suspense>
    );

    expect(await screen.findByRole("heading", { name: "A little turbulence in the reef." })).toBeInTheDocument();
    expect(screen.queryByText(/You can provide a way better UX than this/i)).not.toBeInTheDocument();
  });

  it("keeps workspace navigation when a child crashes and recovers through navigation", async () => {
    function BrokenPage(): never { throw new Error("secret component stack"); }
    const router = createMemoryRouter([{
      path: "/manager",
      element: <WorkspaceErrorContext.Provider value="/manager"><nav aria-label="Workspace">Manager navigation</nav><main><Outlet /></main></WorkspaceErrorContext.Provider>,
      children: [{
        element: <Outlet />, errorElement: <RouteErrorPage />,
        children: [
          { path: "broken", element: <BrokenPage /> },
          { index: true, element: <h1>Working dashboard</h1> },
        ],
      }],
    }], { initialEntries: ["/manager/broken"] });
    const { container } = render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "A little turbulence in the reef." })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeVisible();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container).not.toHaveTextContent("secret component stack");
    fireEvent.click(screen.getByRole("link", { name: "Back to workspace" }));
    expect(await screen.findByRole("heading", { name: "Working dashboard" })).toBeVisible();
    router.dispose();
  });
});
