import { render, screen } from "@testing-library/react";

import {
  advancedFilterFieldHighlight,
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
  advancedFilterSummaryChipClass,
  advancedFilterSyncBadgeClass,
  buildQuickTextFilterRules,
  formatAdvancedFilterSyncLabel,
  progressFromAdvancedSearchEvent,
  resolveQuickTextFilterState,
  resolveTextFilterInputState,
  resolveTextFilterFieldState,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  shouldShowActiveFilterSummary,
  type AdvancedSearchProgress,
} from "./advancedFilterShared";

describe("advancedFilterShared", () => {
  it("resolves exact-list text input state centrally", () => {
    expect(resolveTextFilterInputState(" Alpha, beta, alpha ", "contains")).toEqual({
      value: "Alpha, beta, alpha",
      parsed: {
        values: ["Alpha", "beta"],
        listProvided: true,
      },
      forcesExact: true,
      effectiveMode: "exact",
    });
    expect(resolveTextFilterInputState(" archive ", "contains")).toMatchObject({
      value: "archive",
      forcesExact: false,
      effectiveMode: "contains",
    });
  });

  it("prioritizes pending field presentation over applied presentation", () => {
    expect(advancedFilterFieldHighlight(true, true)).toEqual({
      labelClass: expect.stringContaining("text-amber-700"),
      fieldClass: expect.stringContaining("border-amber-400"),
    });
    expect(advancedFilterFieldHighlight(true, false)).toEqual({
      labelClass: expect.stringContaining("text-emerald-700"),
      fieldClass: expect.stringContaining("border-emerald-400"),
    });
    expect(advancedFilterFieldHighlight(false, false)).toEqual({
      labelClass: "",
      fieldClass: "",
    });
  });

  it("resolves shared advanced text field modes and pending state", () => {
    const listState = resolveTextFilterFieldState({
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

    const appliedState = resolveTextFilterFieldState({
      draftValue: "alice",
      draftMode: "exact",
      appliedValue: " alice ",
      appliedMode: "exact",
    });
    expect(appliedState.pending).toBe(false);
    expect(appliedState.fieldState.fieldClass).toContain("border-emerald-400");
  });

  it("derives quick text filter modes from draft and applied list input", () => {
    expect(
      resolveQuickTextFilterState({
        draftValue: " alpha, beta ",
        appliedValue: "alpha, beta",
        mode: "contains",
      }),
    ).toMatchObject({
      active: true,
      draftForcesExact: true,
      effectiveMode: "exact",
      effectiveSearchValue: "",
      modeForDisplay: "exact",
      pending: false,
    });
  });

  it("keeps a scalar contains filter as the effective quick search", () => {
    expect(
      resolveQuickTextFilterState({
        draftValue: "archive",
        appliedValue: " archive ",
        mode: "contains",
      }),
    ).toMatchObject({
      active: true,
      draftForcesExact: false,
      effectiveMode: "contains",
      effectiveSearchValue: " archive ",
      modeForDisplay: "contains",
      pending: false,
    });
  });

  it("builds server-side quick filter rules only for exact input", () => {
    expect(buildQuickTextFilterRules("uid", "alice", "contains")).toEqual([]);
    expect(buildQuickTextFilterRules("uid", "alice", "exact")).toEqual([
      { field: "uid", op: "eq", value: "alice" },
    ]);
    expect(buildQuickTextFilterRules("uid", "alice, bob", "contains")).toEqual([
      { field: "uid", op: "in", value: ["alice", "bob"] },
    ]);
    expect(buildQuickTextFilterRules("uid", "  ", "exact")).toEqual([]);
  });

  it("shows active filter summaries when quick search needs extra context", () => {
    expect(
      shouldShowActiveFilterSummary({
        itemCount: 0,
        quickFilterActive: false,
        hasNonQuickFilters: false,
        quickFilterListProvided: false,
      }),
    ).toBe(false);
    expect(
      shouldShowActiveFilterSummary({
        itemCount: 1,
        quickFilterActive: true,
        hasNonQuickFilters: false,
        quickFilterListProvided: false,
      }),
    ).toBe(false);
    expect(
      shouldShowActiveFilterSummary({
        itemCount: 1,
        quickFilterActive: true,
        hasNonQuickFilters: true,
        quickFilterListProvided: false,
      }),
    ).toBe(true);
    expect(
      shouldShowActiveFilterSummary({
        itemCount: 1,
        quickFilterActive: true,
        hasNonQuickFilters: false,
        quickFilterListProvided: true,
      }),
    ).toBe(true);
    expect(
      shouldShowActiveFilterSummary({
        itemCount: 2,
        quickFilterActive: true,
        hasNonQuickFilters: false,
        quickFilterListProvided: false,
      }),
    ).toBe(true);
  });

  it("normalizes advanced-search progress events consistently", () => {
    expect(
      progressFromAdvancedSearchEvent({
        percent: 121.6,
        processed: 12.4,
        total: 10.2,
        stage: "scan",
        message: "Scanning buckets",
      }),
    ).toEqual({
      active: true,
      determinate: true,
      percent: 100,
      stage: "scan",
      message: "Scanning buckets",
      processed: 10,
      total: 10,
    });
  });

  it("returns stable advanced-filter field card classes", () => {
    expect(advancedFilterFieldCardClass()).toBe("rounded-lg border border-[color:var(--ui-border-soft)] p-3");
    expect(advancedFilterFieldCardClass("md:col-span-2")).toBe(
      "rounded-lg border border-[color:var(--ui-border-soft)] p-3 md:col-span-2"
    );
  });

  it("returns stable advanced-filter control classes", () => {
    expect(advancedFilterControlClass()).toContain("ui-control-compact");
    expect(advancedFilterControlClass()).toContain("ui-list-control");
    expect(advancedFilterControlClass("mt-2 w-full")).toContain("mt-2 w-full");
    expect(advancedFilterControlClass("", true)).toContain("disabled:cursor-not-allowed");
  });

  it("returns stable advanced-filter status badges and summary chip classes", () => {
    expect(advancedFilterSyncBadgeClass(true)).toContain("bg-amber-100");
    expect(advancedFilterSyncBadgeClass(false)).toContain("bg-emerald-100");
    expect(formatAdvancedFilterSyncLabel(true)).toBe("Unsaved changes");
    expect(formatAdvancedFilterSyncLabel(false)).toBe("In sync");
    expect(advancedFilterSummaryChipClass).toContain("bg-primary/10");
  });

  it("renders advanced-filter header badges consistently", () => {
    render(
      <>
        {renderAdvancedFilterRuleCountBadge(1)}
        {renderAdvancedFilterRuleCountBadge(2)}
        {renderAdvancedFilterCostBadge("high", "High cost")}
      </>
    );

    expect(screen.getByText("1 rule")).toBeInTheDocument();
    expect(screen.getByText("2 rules")).toBeInTheDocument();
    expect(screen.getByText("Global draft cost")).toHaveAttribute("title", "High cost");
  });

  it("renders advanced-filter draft summaries consistently", () => {
    const { rerender } = render(<>{renderAdvancedFilterDraftSummary([])}</>);

    expect(screen.getByText("Draft summary")).toBeInTheDocument();
    expect(screen.getByText("No advanced rule in draft.")).toBeInTheDocument();

    rerender(
      <>
        {renderAdvancedFilterDraftSummary([
          { id: "owner", label: "Owner contains demo" },
          { id: "bytes", label: "Size greater than 1 GiB" },
        ])}
      </>
    );

    expect(screen.getByText("Owner contains demo")).toBeInTheDocument();
    expect(screen.getByText("Size greater than 1 GiB")).toBeInTheDocument();
    expect(screen.queryByText("No advanced rule in draft.")).not.toBeInTheDocument();
  });

  it("renders progress through the shared progressbar primitive", () => {
    const progress: AdvancedSearchProgress = {
      active: true,
      determinate: true,
      percent: 42,
      stage: "scan",
      message: "Scanning buckets",
      processed: 21,
      total: 50,
    };

    render(<>{renderAdvancedSearchProgress(progress)}</>);

    expect(screen.getByText("Advanced search in progress · 42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Advanced search progress" })).toHaveAttribute(
      "aria-valuenow",
      "42"
    );
  });
});
