import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserPresetsControl from "./BrowserPresetsControl";
import type { BrowserPreset, BrowserPresetInput } from "../../api/browserPresets";

const mocks = vi.hoisted(() => ({ list: vi.fn(), buckets: vi.fn(), objects: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("../../api/browserPresets", () => ({ listBrowserPresets: mocks.list, saveBrowserPreset: mocks.save, deleteBrowserPreset: mocks.remove, browserPresetInput: (value: unknown) => value }));
vi.mock("../../api/browserBuckets", () => ({ searchBrowserBuckets: mocks.buckets }));
vi.mock("../../api/browserObjects", () => ({ listBrowserObjects: mocks.objects }));
const current: BrowserPresetInput = { name: "Saved", kind: "favorite", context: "101", bucket: "reports", prefix: "études//", surface: "browser", workspace: "browser", view: null };
const saved: BrowserPreset = { ...current, id: "saved", revision: 1, created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" };
describe("saved Browser locations", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([saved]); mocks.buckets.mockResolvedValue({ items: [{ name: "reports" }] }); mocks.objects.mockResolvedValue({ objects: [], prefixes: [] }); });
  it("rechecks the exact saved identity before applying a location", async () => {
    const apply = vi.fn(); render(<BrowserPresetsControl current={current} accountUser onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites and views" }));
    fireEvent.click(await screen.findByRole("button", { name: "★ Saved" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(saved));
    expect(mocks.objects).toHaveBeenCalledWith("101", "reports", expect.objectContaining({ prefix: "études//", workspaceSurface: "browser" }));
  });
  it("keeps an inaccessible entry and never changes identity", async () => {
    const apply = vi.fn(); mocks.buckets.mockRejectedValue(new Error("Access revoked"));
    render(<BrowserPresetsControl current={current} accountUser onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites and views" }));
    fireEvent.click(await screen.findByRole("button", { name: "★ Saved" }));
    expect(await screen.findByText("Unavailable: Access revoked")).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });
  it("explains why temporary S3 sessions cannot synchronize", async () => {
    render(<BrowserPresetsControl current={current} accountUser={false} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorites and views" }));
    expect(screen.getByText(/Synchronization requires a UI account/)).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
