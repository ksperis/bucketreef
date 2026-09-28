import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "../../components/theme";
import { setSessionUserCache } from "../../utils/workspaces";
import NotFoundPage from "./NotFoundPage";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <NotFoundPage />
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("NotFoundPage", () => {
  beforeEach(() => {
    setSessionUserCache(null);
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("keeps the missing URL in the address bar and offers sign in to visitors", () => {
    renderPage("/missing/page?source=bookmark");

    expect(screen.getByRole("heading", { name: "This page has drifted away." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Requested path")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/missing/page?source=bookmark");
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  it("offers the authenticated user's workspace without redirecting", () => {
    setSessionUserCache({ email: "admin@example.com", role: "ui_admin" });

    renderPage("/admin/removed-page");

    expect(screen.getByLabelText("Current location")).toHaveTextContent("/admin/removed-page");
    expect(screen.getByRole("link", { name: "Back to workspace" })).toHaveAttribute("href", "/admin");
  });
});
