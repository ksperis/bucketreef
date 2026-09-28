import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ObjectVersionInspector from "./ObjectVersionInspector";
import { objectVersionDiff } from "./objectVersionDiff";

const versions = [{ version_id: "old", size: 15, last_modified: "2026-01-01T00:00:00Z" }, { version_id: "new", size: 15, last_modified: "2026-02-01T00:00:00Z" }, { version_id: "deleted", is_delete_marker: true }];
describe("read-only version inspector", () => {
  it("reads the two selected versions and shows content changes without mutation controls", async () => {
    const loadVersion = vi.fn(async (id: string) => {
      const text = id === "old" ? "same\nold\n" : "same\nnew\n";
      // jsdom's Blob omits the standard text() method.
      return Object.assign(new Blob([text], { type: "text/plain" }), { text: async () => text });
    });
    render(<ObjectVersionInspector name="report.txt" versions={versions} loadVersion={loadVersion} />);
    expect(screen.queryByRole("option", { name: /deleted/ })).toBeNull();
    expect(loadVersion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compare versions" }));
    await waitFor(() => expect(screen.getByText(/lines; − first/)).toHaveTextContent("+1 / −1"));
    expect(loadVersion.mock.calls.map(call => call[0])).toEqual(["old", "new"]);
    expect(screen.queryByRole("button", { name: /Restore|Delete/ })).toBeNull();
  });
  it("rejects oversized versions before reading and rejects actual binary contents", async () => {
    const loadVersion = vi.fn(async () => new Blob(["binary"], { type: "image/png" }));
    const view = render(<ObjectVersionInspector name="report.bin" versions={versions} loadVersion={loadVersion} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare versions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("text and JSON only");
    view.unmount(); loadVersion.mockClear();
    render(<ObjectVersionInspector name="large.txt" versions={[{ version_id: "large", size: 51 * 1024 * 1024 }, versions[0]]} loadVersion={loadVersion} />);
    expect(screen.getByRole("button", { name: "Preview version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Compare versions" })).toBeDisabled();
    expect(loadVersion).not.toHaveBeenCalled();
  });
  it("aborts a pending historical read when closed", async () => {
    let signal: AbortSignal | undefined;
    render(<ObjectVersionInspector name="report.txt" versions={versions} loadVersion={(_id, abort) => { signal = abort; return new Promise(() => undefined); }} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview version" }));
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(signal?.aborted).toBe(true);
  });
  it.each([["a\nb\nc\n", "a\nX\nb\nc\n"], ["abc", "abc\n"], ["", "new"], ["x\n".repeat(2000), "y\n".repeat(2000)]])("produces a lossless bounded diff", (before, after) => {
    const result = objectVersionDiff(before, after);
    expect(result.filter(line => line.kind !== "added").map(line => line.text).join("")).toBe(before);
    expect(result.filter(line => line.kind !== "removed").map(line => line.text).join("")).toBe(after);
  });
});
