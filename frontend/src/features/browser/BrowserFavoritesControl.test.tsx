import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserFavoritesControl from "./BrowserFavoritesControl";
import type { BrowserFavorite, BrowserFavoriteInput } from "../../api/browserFavorites";

const current: BrowserFavoriteInput = {
  name: "études",
  context: "101",
  bucket: "reports",
  prefix: "études//",
  surface: "browser",
  workspace: "browser",
};
const saved: BrowserFavorite = {
  ...current,
  name: "Saved",
  id: "saved",
  revision: 1,
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
};

const buildProps = () => ({
  current,
  accountUser: true,
  favorites: [saved],
  onApply: vi.fn(),
  onRemove: vi.fn(),
  busy: false,
  error: "",
  unavailable: {},
});

describe("saved Browser locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the bucket and execution context below each sidebar favorite", () => {
    render(
      <BrowserFavoritesControl
        {...buildProps()}
        contextLabels={{ "101": "Research" }}
      />,
    );

    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByTitle("reports / études// · Research")).toBeVisible();
    expect(screen.getByText("1 favorite")).toBeVisible();
    expect(screen.getByRole("region", { name: "Favorites" })).toContainElement(
      screen.getByText("Saved"),
    );
    expect(screen.queryByRole("region", { name: "Locations" })).not.toBeInTheDocument();
  });

  it("shows the Storage Space name instead of its technical bucket for the current context", () => {
    const technicalNamed = { ...saved, name: "reports" };
    render(
      <BrowserFavoritesControl
        {...buildProps()}
        favorites={[technicalNamed]}
        bucketLabels={new Map([["reports", "Research Data"]])}
        bucketDetailsByName={new Map([
          [
            "reports",
            {
              name: "reports",
              display_name: "Research Data",
              icon: { source: "preset", preset: "media" },
            },
          ],
        ])}
      />,
    );

    expect(screen.getByText("Research Data", { exact: true })).toBeVisible();
    expect(screen.getByText("Research Data / études//")).toBeVisible();
    expect(
      screen
        .getByTitle("Research Data · Research Data / études//")
        .querySelector('[data-storage-space-icon-preset="media"]'),
    ).toHaveClass("h-6", "w-6");
    expect(screen.queryByText("reports", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("reports / études//")).not.toBeInTheDocument();
  });

  it("opens a saved location and removes it directly from the yellow star", () => {
    const props = buildProps();
    render(<BrowserFavoritesControl {...props} />);

    const remove = screen.getByRole("button", {
      name: "Remove from favorites: Saved",
    });
    expect(remove).toHaveAttribute("aria-pressed", "true");
    expect(remove.querySelector("svg")).toHaveClass(
      "text-yellow-400",
      "dark:text-yellow-300",
    );

    fireEvent.click(screen.getByTitle("Saved · reports / études//"));
    expect(props.onApply).toHaveBeenCalledWith(saved);

    fireEvent.click(remove);
    expect(props.onRemove).toHaveBeenCalledWith(saved);
  });

  it("keeps an inaccessible entry visible with its explanation", () => {
    render(
      <BrowserFavoritesControl
        {...buildProps()}
        unavailable={{ saved: "Access revoked" }}
      />,
    );

    expect(screen.getByText("Access revoked")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove from favorites: Saved" }),
    ).toBeEnabled();
  });

  it("explains why temporary S3 sessions cannot synchronize", () => {
    render(
      <BrowserFavoritesControl
        {...buildProps()}
        accountUser={false}
        favorites={[]}
      />,
    );

    expect(screen.getByText(/Synchronization requires a UI account/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove from favorites/ })).not.toBeInTheDocument();
  });

  it("searches the resolved Storage Space label and the technical bucket", () => {
    const technicalNamed = { ...saved, name: "reports" };
    render(
      <BrowserFavoritesControl
        {...buildProps()}
        favorites={[technicalNamed]}
        bucketLabels={new Map([["reports", "Research Data"]])}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search favorites" });
    fireEvent.change(search, { target: { value: "research data" } });
    expect(screen.getByText("Research Data", { exact: true })).toBeVisible();

    fireEvent.change(search, { target: { value: "reports" } });
    expect(screen.getByText("Research Data", { exact: true })).toBeVisible();
  });
});
