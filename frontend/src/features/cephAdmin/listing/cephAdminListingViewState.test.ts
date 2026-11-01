import { beforeEach, describe, expect, it } from "vitest";

import {
  loadCephAdminVisibleColumns,
  persistCephAdminVisibleColumns,
  resolveCephAdminQuickFilterState,
  resolveCephAdminTextFilterFieldState,
} from "./cephAdminListingViewState";

describe("Ceph Admin listing view state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("filters persisted columns to the current listing contract", () => {
    persistCephAdminVisibleColumns("ceph-admin.test.columns", ["tenant", "legacy"]);

    expect(
      loadCephAdminVisibleColumns(
        "ceph-admin.test.columns",
        ["tenant", "email"],
        ["tenant"],
      ),
    ).toEqual(["tenant"]);
  });

  it("falls back to default columns when persisted state is empty or invalid", () => {
    window.localStorage.setItem("ceph-admin.test.columns", JSON.stringify([]));
    expect(
      loadCephAdminVisibleColumns(
        "ceph-admin.test.columns",
        ["tenant", "email"],
        ["tenant"],
      ),
    ).toEqual(["tenant"]);

    window.localStorage.setItem("ceph-admin.test.columns", "not-json");
    expect(
      loadCephAdminVisibleColumns(
        "ceph-admin.test.columns",
        ["tenant", "email"],
        ["tenant"],
      ),
    ).toEqual(["tenant"]);
  });

  it("forces exact mode for list input and tracks pending draft state", () => {
    const state = resolveCephAdminQuickFilterState(
      "alice,bob",
      "alice,bob",
      "contains",
    );

    expect(state.modeForDisplay).toBe("exact");
    expect(state.draftForcesExact).toBe(true);
    expect(state.effectiveMode).toBe("exact");
    expect(state.effectiveSearchValue).toBe("");
    expect(state.appliedParsed.values).toEqual(["alice", "bob"]);
    expect(state.pending).toBe(false);
  });

  it("keeps contains search active and highlights a pending draft", () => {
    const state = resolveCephAdminQuickFilterState(
      "alice updated",
      "alice",
      "contains",
    );

    expect(state.effectiveSearchValue).toBe("alice");
    expect(state.active).toBe(true);
    expect(state.pending).toBe(true);
    expect(state.fieldState.fieldClass).not.toBe("");
  });

  it("resolves advanced text field modes and pending state", () => {
    const listState = resolveCephAdminTextFilterFieldState({
      draftValue: " alice, bob ",
      draftMode: "contains",
      appliedValue: "alice,bob",
      appliedMode: "contains",
    });

    expect(listState.draftValue).toBe("alice, bob");
    expect(listState.appliedValue).toBe("alice,bob");
    expect(listState.draftForcesExact).toBe(true);
    expect(listState.draftMode).toBe("exact");
    expect(listState.appliedMode).toBe("exact");
    expect(listState.pending).toBe(true);
    expect(listState.fieldState.fieldClass).toContain("border-amber-400");

    const appliedState = resolveCephAdminTextFilterFieldState({
      draftValue: "alice",
      draftMode: "exact",
      appliedValue: " alice ",
      appliedMode: "exact",
    });
    expect(appliedState.pending).toBe(false);
    expect(appliedState.fieldState.fieldClass).toContain("border-emerald-400");
  });
});
