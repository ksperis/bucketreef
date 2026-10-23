import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInlinePolicyDraftEditor } from "./useInlinePolicyDraftEditor";

describe("useInlinePolicyDraftEditor", () => {
  it("creates, selects, and removes normalized inline policy drafts", () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useInlinePolicyDraftEditor(setError));

    act(() => {
      result.current.editorProps.onDraftNameChange("  audit-inline  ");
      result.current.editorProps.onDraftTextChange('{"Version":"2012-10-17"}');
    });
    act(() => result.current.editorProps.onSaveDraft());

    expect(result.current.inlineDrafts).toEqual([
      { name: "audit-inline", document: { Version: "2012-10-17" } },
    ]);
    expect(result.current.editorProps.selectedDraftName).toBe("audit-inline");
    expect(result.current.editorProps.mode).toBe("edit");
    expect(result.current.inlinePolicyText).toBe(
      '{\n  "Version": "2012-10-17"\n}'
    );
    expect(setError).toHaveBeenLastCalledWith(null);

    act(() => result.current.editorProps.onCreateDraft());
    expect(result.current.editorProps.mode).toBe("create");
    expect(result.current.inlineDraftName).toBe("");

    act(() => result.current.editorProps.onSelectDraft("audit-inline"));
    expect(result.current.editorProps.mode).toBe("edit");
    expect(result.current.inlineDraftName).toBe("audit-inline");

    act(() => result.current.editorProps.onRemoveDraft("audit-inline"));
    expect(result.current.inlineDrafts).toEqual([]);
    expect(result.current.editorProps.mode).toBe("create");
  });

  it("reports missing names and invalid JSON without saving a draft", () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useInlinePolicyDraftEditor(setError));

    act(() => result.current.editorProps.onSaveDraft());
    expect(result.current.editorProps.nameError).toBe("Inline policy name is required.");
    expect(setError).not.toHaveBeenCalled();

    act(() => {
      result.current.editorProps.onDraftNameChange("invalid-json");
      result.current.editorProps.onDraftTextChange("{");
    });
    act(() => result.current.editorProps.onSaveDraft());
    expect(setError).toHaveBeenLastCalledWith("Inline policy must be valid JSON.");
    expect(result.current.inlineDrafts).toEqual([]);
  });

  it("keeps expansion on clear and closes it on lifecycle reset", () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useInlinePolicyDraftEditor(setError));

    act(() => {
      result.current.editorProps.onToggleExpanded?.();
      result.current.editorProps.onDraftNameChange("temporary");
      result.current.editorProps.onClearDrafts();
    });
    expect(result.current.editorProps.expanded).toBe(true);

    act(() => result.current.resetInlinePolicyDraftEditor());
    expect(result.current.editorProps.expanded).toBe(false);
    expect(result.current.inlineDraftName).toBe("");
    expect(result.current.inlineDrafts).toEqual([]);
  });
});
