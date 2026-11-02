import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBucketEditorRowIds } from "../useBucketEditorRowIds";

describe("useBucketEditorRowIds", () => {
  it("keeps row identity stable across append, remove, and restore operations", () => {
    const { result } = renderHook(() => useBucketEditorRowIds("test-row"));

    act(() => result.current.resetRowIds(2));
    const [firstId, secondId] = result.current.rowIds;

    expect(firstId).toMatch(/^test-row-/);
    expect(secondId).toMatch(/^test-row-/);
    expect(firstId).not.toBe(secondId);

    act(() => result.current.appendRowId());
    const thirdId = result.current.rowIds[2];
    expect(result.current.rowIds.slice(0, 2)).toEqual([firstId, secondId]);
    expect(thirdId).toMatch(/^test-row-/);

    act(() => result.current.removeRowId(1));
    expect(result.current.rowIds).toEqual([firstId, thirdId]);

    act(() => result.current.insertRowId(1, secondId));
    expect(result.current.rowIds).toEqual([firstId, secondId, thirdId]);
  });

  it("regenerates row identity when the editor draft is replaced", () => {
    const { result } = renderHook(() => useBucketEditorRowIds("test-row"));

    act(() => result.current.resetRowIds(2));
    const previousIds = result.current.rowIds;

    act(() => result.current.resetRowIds(2));

    expect(result.current.rowIds).toHaveLength(2);
    expect(result.current.rowIds).not.toEqual(previousIds);
  });
});
