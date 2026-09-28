import { act, fireEvent, renderHook, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { numberedBrowserKey, useBrowserWriteConflicts } from "./useBrowserWriteConflicts";
import { inspectBrowserDestinations } from "../../api/browserConflicts";
vi.mock("../../api/browserConflicts", () => ({ inspectBrowserDestinations: vi.fn() }));
const inspect = vi.mocked(inspectBrowserDestinations);
describe("write conflicts", () => {
  beforeEach(() => vi.clearAllMocks());
  it("preserves literal keys and inserts a suffix before the extension", () => {
    expect(numberedBrowserKey("a//été.csv", 2)).toBe("a//été (2).csv");
    expect(numberedBrowserKey(".env", 1)).toBe(".env (1)");
  });
  it("prepares absent objects with a create-only observation", async () => {
    inspect.mockResolvedValue({ protection: "conditional", objects: [{ key: "a", exists: false, etag: null }] });
    const { result } = renderHook(() => useBrowserWriteConflicts("conn-1", "bucket", undefined, null, false));
    await expect(result.current.prepare([{ id: "1", key: "a" }])).resolves.toEqual([{ id: "1", key: "a", writeGuard: { exists: false, etag: null } }]);
  });
  it("requires a decision and rechecks a numbered candidate", async () => {
    inspect.mockResolvedValueOnce({ protection: "preflight", objects: [{ key: "a.txt", exists: true, etag: '"old"', size: 10 }] });
    inspect.mockResolvedValueOnce({ protection: "preflight", objects: [{ key: "a (1).txt", exists: false, etag: null }] });
    let prepare: ReturnType<typeof useBrowserWriteConflicts>["prepare"];
    function Harness() { const state = useBrowserWriteConflicts("conn-1", "bucket", undefined, null, false); prepare = state.prepare; return state.conflictDialog; }
    render(<Harness />);
    let pending: ReturnType<typeof prepare>;
    act(() => { pending = prepare([{ id: "1", key: "a.txt", size: 4 }]); });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Apply decisions" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Keep both for all" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply decisions" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(pending!).resolves.toMatchObject([{ key: "a (1).txt", writeGuard: { exists: false } }]);
  });
});
