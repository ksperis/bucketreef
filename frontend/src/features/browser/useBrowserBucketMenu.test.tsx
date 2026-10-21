import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBrowserBucketMenu } from "./useBrowserBucketMenu";

describe("useBrowserBucketMenu", () => {
  it("owns menu visibility, focus, and outside dismissal", async () => {
    const { result } = renderHook(() => useBrowserBucketMenu());
    const root = document.createElement("div");
    const input = document.createElement("input");
    const outside = document.createElement("button");
    root.append(input);
    document.body.append(root, outside);
    result.current.rootRef.current = root;
    result.current.filterInputRef.current = input;

    act(() => result.current.toggle());

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(result.current.open).toBe(true);

    act(() => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(result.current.open).toBe(false);
    root.remove();
    outside.remove();
  });

  it("exposes an explicit close action", () => {
    const { result } = renderHook(() => useBrowserBucketMenu());

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});
