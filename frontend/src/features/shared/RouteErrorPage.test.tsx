import { render, screen } from "@testing-library/react";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../components/theme";
import { ApiError } from "../../api/client";
import RouteErrorPage from "./RouteErrorPage";
import { setSessionUserCache } from "../../utils/workspaces";

function ThrowingRoute({ error }: { error: unknown }) {
  throw error;
}

function renderRouteError(error: unknown) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
        <Route path="/" element={<ThrowingRoute error={error} />} />
      </Route>
    ),
    { initialEntries: ["/"] }
  );

  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

describe("RouteErrorPage", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    setSessionUserCache(null);
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    document.documentElement.className = "";
    vi.restoreAllMocks();
  });

  it("shows the backend outage copy with light theme styling and home actions", async () => {
    setSessionUserCache({ email: "admin@example.com", role: "ui_admin" });
    window.localStorage.setItem("theme", "light");

    const { container } = renderRouteError(new ApiError("Network Error"));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(container.querySelector(".error-state--full")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "A small setback under the sea." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to workspace" })).toHaveAttribute("href", "/admin");
  });

  it("shows generic copy in dark mode without exposing the raw error detail", async () => {
    window.localStorage.setItem("theme", "dark");

    const { container } = renderRouteError(new Error("super secret backend stack"));

    expect(document.documentElement).toHaveClass("dark");
    expect(container.querySelector(".error-state--full")).toBeInTheDocument();
    expect(container.querySelector("section")).toHaveClass("error-state-content");
    expect(await screen.findByRole("heading", { name: "A little turbulence in the reef." })).toBeInTheDocument();
    expect(screen.queryByText("super secret backend stack")).not.toBeInTheDocument();
  });
});
