import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "../../components/theme";
import FeatureDisabledPage from "./FeatureDisabledPage";

function renderPage(theme?: "light" | "dark") {
  if (theme) {
    window.localStorage.setItem("theme", theme);
  }

  return render(
    <ThemeProvider>
      <MemoryRouter>
        <FeatureDisabledPage feature="Browser" />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe("FeatureDisabledPage", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
  });

  it("renders with the light theme shell and expected actions", () => {
    const { container } = renderPage("light");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(container.querySelector(".error-state")).toHaveClass("error-state--full");
    expect(container.querySelector("section")).toHaveAttribute("data-error-kind", "feature_disabled");
    expect(screen.getByRole("heading", { name: "This passage is closed for now." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  it("renders with the dark theme shell", () => {
    const { container } = renderPage("dark");

    expect(document.documentElement).toHaveClass("dark");
    expect(container.querySelector(".error-state")).toHaveClass("error-state--full");
    expect(container.querySelector("section")).toHaveAttribute("data-error-kind", "feature_disabled");
  });
});
