/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import useAdminStorageAssociationEditorState from "./useAdminStorageAssociationEditorState";

describe("useAdminStorageAssociationEditorState", () => {
  it("separates pending-selection cleanup from a full reset", () => {
    const { result } = renderHook(() => useAdminStorageAssociationEditorState());

    act(() => {
      result.current.setTab("connections");
      result.current.accounts.picker.setOpen(true);
      result.current.accounts.picker.setSearch("prod");
      result.current.accounts.picker.setSelections([1]);
      result.current.s3Users.picker.setSelections([2]);
      result.current.connections.picker.setSelections([3]);
      result.current.openStack.picker.setSelections([4]);
      result.current.accounts.setAccessChoice({
        1: {
          manager_role: "account_administrator",
          portal_role: null,
          allow_manager_browser_data_access: false,
        },
      });
    });

    act(() => result.current.clearPendingSelections());

    expect(result.current.tab).toBe("connections");
    expect(result.current.accounts.picker.open).toBe(true);
    expect(result.current.accounts.picker.search).toBe("prod");
    expect(result.current.accounts.picker.selections).toEqual([]);
    expect(result.current.s3Users.picker.selections).toEqual([]);
    expect(result.current.connections.picker.selections).toEqual([]);
    expect(result.current.openStack.picker.selections).toEqual([]);
    expect(result.current.accounts.accessChoice).toEqual({});

    act(() => {
      result.current.accounts.picker.setSelections([1]);
      result.current.reset();
    });

    expect(result.current.tab).toBe("accounts");
    expect(result.current.accounts.picker.open).toBe(false);
    expect(result.current.accounts.picker.search).toBe("");
    expect(result.current.accounts.picker.selections).toEqual([]);
    expect(result.current.accounts.accessChoice).toEqual({});
  });

  it("closes picker panels without discarding their search or selection state", () => {
    const { result } = renderHook(() => useAdminStorageAssociationEditorState());

    act(() => {
      result.current.s3Users.picker.setOpen(true);
      result.current.s3Users.picker.setSearch("archive");
      result.current.s3Users.picker.setSelections([11]);
    });

    act(() => result.current.closePickers());

    expect(result.current.s3Users.picker.open).toBe(false);
    expect(result.current.s3Users.picker.search).toBe("archive");
    expect(result.current.s3Users.picker.selections).toEqual([11]);
  });
});
