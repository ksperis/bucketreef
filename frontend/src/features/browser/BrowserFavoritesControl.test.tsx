import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserFavoritesControl from "./BrowserFavoritesControl";
import type { BrowserFavorite, BrowserFavoriteInput } from "../../api/browserFavorites";

const mocks = vi.hoisted(() => ({ list: vi.fn(), buckets: vi.fn(), objects: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("../../api/browserFavorites", () => ({ listBrowserFavorites: mocks.list, saveBrowserFavorite: mocks.save, deleteBrowserFavorite: mocks.remove, browserFavoriteInput: (value: unknown) => value }));
vi.mock("../../api/browserBuckets", () => ({ searchBrowserBuckets: mocks.buckets }));
vi.mock("../../api/browserObjects", () => ({ listBrowserObjects: mocks.objects }));
const current: BrowserFavoriteInput = { name: "Saved", context: "101", bucket: "reports", prefix: "études//", surface: "browser", workspace: "browser" };
const saved: BrowserFavorite = { ...current, id: "saved", revision: 1, created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" };
describe("saved Browser locations", () => {
  it("shows the bucket and execution context below each sidebar favorite", async () => {
    mocks.list.mockResolvedValue([saved]);
    render(<BrowserFavoritesControl current={current} accountUser onApply={vi.fn()} variant="sidebar" contextLabels={{ "101": "Research" }} />);
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByTitle("reports / études// · Research")).toBeVisible();
    expect(screen.getByRole("region", { name: "Locations" })).toContainElement(screen.getByText("Saved"));
    expect(screen.queryByText("Saved views")).not.toBeInTheDocument();
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([saved]); mocks.buckets.mockResolvedValue({ items: [{ name: "reports" }] }); mocks.objects.mockResolvedValue({ objects: [], prefixes: [] }); });
  it("rechecks the exact saved identity before applying a location", async () => {
    const apply = vi.fn(); render(<BrowserFavoritesControl current={current} accountUser onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    fireEvent.click(await screen.findByRole("button", { name: "★ Saved" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(saved));
    expect(mocks.objects).toHaveBeenCalledWith("101", "reports", expect.objectContaining({ prefix: "études//", workspaceSurface: "browser" }));
  });
  it("keeps an inaccessible entry and never changes identity", async () => {
    const apply = vi.fn(); mocks.buckets.mockRejectedValue(new Error("Access revoked"));
    render(<BrowserFavoritesControl current={current} accountUser onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    fireEvent.click(await screen.findByRole("button", { name: "★ Saved" }));
    expect(await screen.findByText("Unavailable: Access revoked")).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });
  it("explains why temporary S3 sessions cannot synchronize", async () => {
    render(<BrowserFavoritesControl current={current} accountUser={false} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(screen.getByText(/Synchronization requires a UI account/)).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("saves only an exact path and can rename and remove a favorite", async () => {
    render(<BrowserFavoritesControl current={current} accountUser onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    await screen.findByRole("button", { name: "★ Saved" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New favorite" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin location" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ ...current, name: "New favorite" }));
    expect(screen.queryByRole("button", { name: "Save view" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Rename saved item"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith({ ...saved, name: "Renamed" }, saved));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(saved));
  });

});
