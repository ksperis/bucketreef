import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import BucketSelectionActionsBar from "./BucketSelectionActionsBar";
import type { ActionProgressState } from "./actionProgress";

const baseProps = {
  selectedCount: 2,
  hiddenSelectedCount: 0,
  clearSelection: vi.fn(),
  availableUiTags: [],
  selectedUiTagSuggestions: [],
  selectionTagAddInput: "",
  setSelectionTagAddInput: vi.fn(),
  parsedSelectionTagAddInput: [],
  selectionTagActionLoading: null as "add" | "remove" | null,
  applyUiTagToSelection: vi.fn(),
  updateUiTagDefinition: vi.fn(),
  updatingDefinitionIds: new Set<number>(),
  selectionExportLoading: null as "text" | "csv" | "json" | null,
  exportSelectedBuckets: vi.fn(),
  selectionActionProgress: null as ActionProgressState | null,
  isStorageOps: false,
  onShowCompareModal: vi.fn(),
  onShowIntegrityModal: vi.fn(),
  onShowUsageStatsModal: vi.fn(),
  openBulkUpdateModal: vi.fn(),
};

function StatefulTags({ apply = vi.fn(), existing = false }: {
  apply?: (tag: unknown, action: "add" | "remove") => Promise<string | null | void> | void;
  existing?: boolean;
}) {
  const [value, setValue] = useState("");
  return <BucketSelectionActionsBar {...baseProps} selectionTagAddInput={value}
    setSelectionTagAddInput={setValue} parsedSelectionTagAddInput={value.split(",").map(v => v.trim()).filter(Boolean)}
    availableUiTags={existing ? [{ id: 1, label: "existing", color_key: "blue", scope: "standard", visibility: "private" }] : []}
    applyUiTagToSelection={apply} />;
}

async function openTagDraft() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Actions for 2 selected buckets" }));
  await user.click(screen.getByRole("menuitem", { name: "Manage UI tags…" }));
  await user.type(screen.getByRole("textbox", { name: "New UI tags" }), "draft");
  await user.keyboard("{Enter}");
  // Close the tag settings popover, leaving the parent dialog open.
  await user.keyboard("{Escape}");
  return user;
}

describe("BucketSelectionActionsBar progress", () => {
  const openActions = () => {
    fireEvent.click(screen.getByRole("button", { name: "Actions for 2 selected buckets" }));
  };

  it("protects configured tags on Escape, keeps them across modes and discards explicitly", async () => {
    render(<StatefulTags />);
    const user = await openTagDraft();
    await user.click(screen.getByRole("button", { name: "Remove tags", exact: true }));
    await user.click(screen.getByRole("button", { name: "Add tags", exact: true }));
    expect(screen.getByRole("button", { name: "Configure UI tag draft, Private" })).toBeInTheDocument();
    // Switching back to the draft reopens its settings before the parent can close.
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("button", { name: "Add 1 tag" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openActions();
    await user.click(screen.getByRole("menuitem", { name: "Manage UI tags…" }));
    expect(screen.queryByRole("button", { name: "Add 1 tag" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New UI tags" })).toHaveValue("");
  });

  it("freezes submission and closing, keeps failed drafts and retries the same tag settings", async () => {
    let settle!: (error: string) => void;
    const apply = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { settle = resolve; }))
      .mockResolvedValue(null);
    render(<StatefulTags apply={apply} />);
    const user = await openTagDraft();
    await user.click(screen.getByRole("button", { name: "Add 1 tag" }));
    expect(screen.getByRole("button", { name: "Add 1 tag" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "New UI tags" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Manage UI tags" })).toBeInTheDocument();
    expect(apply).toHaveBeenCalledOnce();
    await act(async () => settle("Tag service unavailable"));
    expect(screen.getByRole("alert")).toHaveTextContent("Tag service unavailable");
    await user.click(screen.getByRole("button", { name: "Add 1 tag" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]).toEqual(apply.mock.calls[1]);
  });

  it("keeps new-tag drafts while applying an existing tag and clears applied drafts on reopening", async () => {
    const apply = vi.fn().mockResolvedValue(null);
    render(<StatefulTags apply={apply} existing />);
    const user = await openTagDraft();
    await user.click(screen.getByRole("button", { name: "Add UI tag existing" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "add");
    expect(screen.getByRole("button", { name: "Add 1 tag" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add 1 tag" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    openActions();
    await user.click(screen.getByRole("menuitem", { name: "Manage UI tags…" }));
    expect(screen.queryByRole("button", { name: "Add 1 tag" })).not.toBeInTheDocument();
  });

  it.each(["text", "csv", "json"] as const)("keeps %s export immediate with its exact format", async (format) => {
    const exportSelectedBuckets = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} exportSelectedBuckets={exportSelectedBuckets} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Export selection…" }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(format, "i") }));
    expect(exportSelectedBuckets).toHaveBeenCalledExactlyOnceWith(format);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders selection action progress with percent and failures", () => {
    render(
      <BucketSelectionActionsBar
        {...baseProps}
        selectionActionProgress={{
          label: "Preparing CSV export",
          completed: 4,
          total: 10,
          failed: 2,
        }}
      />
    );

    expect(screen.getByText("Preparing CSV export · 4 / 10")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Preparing CSV export progress" })).toHaveAttribute(
      "aria-valuenow",
      "40"
    );
    expect(screen.getByText("Failures so far: 2")).toBeInTheDocument();
  });

  it("does not render progress card when no action is running", () => {
    render(<BucketSelectionActionsBar {...baseProps} />);
    expect(screen.queryByText(/Failures so far:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Preparing CSV export/)).not.toBeInTheDocument();
  });

  it("keeps existing actions usable", () => {
    const openBulkUpdateModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} openBulkUpdateModal={openBulkUpdateModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Configure selected buckets…" }));
    expect(openBulkUpdateModal).toHaveBeenCalledTimes(1);
  });

  it("opens the integrity action from selection", () => {
    const onShowIntegrityModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} onShowIntegrityModal={onShowIntegrityModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Check object integrity…" }));
    expect(onShowIntegrityModal).toHaveBeenCalledTimes(1);
  });

  it("opens the purge action from selection when available", () => {
    const onShowPurgeModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} onShowPurgeModal={onShowPurgeModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Purge bucket contents…" }));
    expect(onShowPurgeModal).toHaveBeenCalledTimes(1);
  });

  it("opens the config backup action for ceph-admin selections", () => {
    const onShowConfigBackupModal = vi.fn();
    render(<BucketSelectionActionsBar {...baseProps} onShowConfigBackupModal={onShowConfigBackupModal} />);
    openActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back up bucket configurations…" }));
    expect(onShowConfigBackupModal).toHaveBeenCalledTimes(1);
  });

  it("hides config backup for storage-ops selections", () => {
    render(<BucketSelectionActionsBar {...baseProps} isStorageOps onShowConfigBackupModal={vi.fn()} />);
    openActions();
    expect(screen.queryByRole("menuitem", { name: "Back up bucket configurations…" })).not.toBeInTheDocument();
  });

  it("moves focus through the grouped action menu and returns it on Escape", () => {
    render(<BucketSelectionActionsBar {...baseProps} />);
    const trigger = screen.getByRole("button", { name: "Actions for 2 selected buckets" });
    fireEvent.click(trigger);
    const firstItem = screen.getByRole("menuitem", { name: "Manage UI tags…" });
    expect(firstItem).toHaveFocus();
    fireEvent.keyDown(firstItem, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Export selection…" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("disables RGW bulk index checks above the 200 bucket limit", () => {
    render(<BucketSelectionActionsBar {...baseProps} selectedCount={201} onShowIndexCheckModal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for 201 selected buckets" }));
    expect(screen.getByRole("menuitem", { name: /Check bucket indexes…/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/limited to 200 buckets/i)).toBeInTheDocument();
  });

  it("configures multiple new tags before applying them with private neutral defaults", async () => {
    const user = userEvent.setup();
    const applyUiTagToSelection = vi.fn();

    function StatefulActions() {
      const [value, setValue] = useState("");
      return (
        <BucketSelectionActionsBar
          {...baseProps}
          selectionTagAddInput={value}
          setSelectionTagAddInput={setValue}
          parsedSelectionTagAddInput={value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)}
          applyUiTagToSelection={applyUiTagToSelection}
        />
      );
    }

    render(<StatefulActions />);
    await user.click(
      screen.getByRole("button", { name: "Actions for 2 selected buckets" })
    );
    await user.click(screen.getByRole("menuitem", { name: "Manage UI tags…" }));
    await user.type(screen.getByRole("textbox", { name: "New UI tags" }), "alpha, beta");
    await user.click(screen.getByRole("button", { name: "Configure" }));

    expect(
      screen.getByRole("button", { name: "Configure UI tag alpha, Private" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Configure UI tag beta, Private" })
    ).toBeInTheDocument();
    const betaSettings = await screen.findByRole("group", {
      name: "Tag settings for beta",
    });
    await user.click(
      within(betaSettings).getByRole("button", {
        name: "Set beta color to Blue",
      })
    );
    await user.click(
      within(betaSettings).getByRole("button", { name: "Shared" })
    );
    await user.click(screen.getByRole("button", { name: "Add 2 tags" }));

    expect(applyUiTagToSelection).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          label: "alpha",
          color_key: "neutral",
          visibility: "private",
        }),
        expect.objectContaining({
          label: "beta",
          color_key: "blue",
          visibility: "shared",
        }),
      ],
      "add"
    );
  });
});
