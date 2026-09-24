import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import BrowserObjectArchiveTab from "./BrowserObjectArchiveTab";
import BrowserObjectPropertiesTab from "./BrowserObjectPropertiesTab";
import BrowserObjectProtectionTab from "./BrowserObjectProtectionTab";
import BrowserObjectVersionsTab from "./BrowserObjectVersionsTab";
import { OBJECT_LOCK_DISABLED_MESSAGE } from "./browserObjectDetailsModel";
import type { ObjectRetentionMode } from "./useBrowserObjectProtection";

const version: BrowserObjectVersion = {
  key: "reports/summary.csv",
  version_id: "version-a",
  is_latest: false,
  is_delete_marker: false,
};

const metadataDraft = {
  contentType: "text/plain",
  cacheControl: "max-age=60",
  contentDisposition: "inline",
  contentEncoding: "",
  contentLanguage: "en",
  expires: "",
};

describe("Browser object detail tabs", () => {
  it("forwards version refresh, pagination, restore, and delete actions", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onLoadMore = vi.fn();
    const onRestoreVersion = vi.fn();
    const onDeleteVersion = vi.fn();
    render(
      <BrowserObjectVersionsTab
        versions={[version]}
        loading={false}
        savingAction={false}
        error={null}
        canLoadMore
        onRefresh={onRefresh}
        onLoadMore={onLoadMore}
        onRestoreVersion={onRestoreVersion}
        onDeleteVersion={onDeleteVersion}
        readOnly={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveClass("ui-list-action");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(
      screen.getByRole("button", { name: "Load more versions" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(
      screen.getByRole("button", { name: "Delete version" }),
    );

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(onRestoreVersion).toHaveBeenCalledWith(version);
    expect(onDeleteVersion).toHaveBeenCalledWith(version);
  });

  it("forwards archive inputs and displays the current restore state", async () => {
    const user = userEvent.setup();
    const onDaysChange = vi.fn();
    const onTierChange = vi.fn();
    const onRestore = vi.fn();
    render(
      <BrowserObjectArchiveTab
        days="7"
        onDaysChange={onDaysChange}
        tier="Standard"
        onTierChange={onTierChange}
        saving={false}
        onRestore={onRestore}
        currentStorageClass="GLACIER"
        restoreStatusLabel="Restore in progress."
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Days" }), {
      target: { value: "14" },
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Tier" }),
      "Bulk",
    );
    await user.click(screen.getByRole("button", { name: "Request restore" }));

    expect(onDaysChange).toHaveBeenCalledWith("14");
    expect(onTierChange).toHaveBeenCalledWith("Bulk");
    expect(onRestore).toHaveBeenCalledOnce();
    expect(screen.getByText("GLACIER")).toBeInTheDocument();
    expect(screen.getByText("Restore in progress.")).toBeInTheDocument();
  });

  it("forwards property draft, row, refresh, and save actions", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onMetadataDraftChange = vi.fn();
    const onAddMetadata = vi.fn();
    const onMetadataItemChange = vi.fn();
    const onRemoveMetadata = vi.fn();
    const onSaveMetadata = vi.fn();
    const onAddTag = vi.fn();
    const onTagChange = vi.fn();
    const onRemoveTag = vi.fn();
    const onSaveTags = vi.fn();
    const onStorageClassChange = vi.fn();
    const onSaveStorageClass = vi.fn();
    render(
      <BrowserObjectPropertiesTab
        readOnly={false}
        loading={false}
        loaded
        error={null}
        metadataDraft={metadataDraft}
        onMetadataDraftChange={onMetadataDraftChange}
        dirtySections={{ metadata: true, tags: false, storageClass: true }}
        savingMetadata={false}
        onSaveMetadata={onSaveMetadata}
        metadataItems={[{ id: "meta-1", key: "project", value: "reef" }]}
        onAddMetadata={onAddMetadata}
        onMetadataItemChange={onMetadataItemChange}
        onRemoveMetadata={onRemoveMetadata}
        tags={[{ id: "tag-1", key: "environment", value: "test" }]}
        onAddTag={onAddTag}
        onTagChange={onTagChange}
        onRemoveTag={onRemoveTag}
        savingTags={false}
        onSaveTags={onSaveTags}
        storageClass="STANDARD"
        onStorageClassChange={onStorageClassChange}
        savingStorageClass={false}
        onSaveStorageClass={onSaveStorageClass}
        onRefresh={onRefresh}
      />,
    );

    expect(within(screen.getByRole("form", { name: "Metadata" })).getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(within(screen.getByRole("form", { name: "Tags" })).queryByRole("status")).not.toBeInTheDocument();
    expect(within(screen.getByRole("form", { name: "Storage class" })).getByRole("status")).toHaveTextContent("Unsaved changes");
    fireEvent.change(screen.getByRole("textbox", { name: "Content type" }), {
      target: { value: "application/json" },
    });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getByRole("button", { name: "Save metadata" }));

    const metadataCard = screen.getByRole("group", { name: "Custom metadata" });
    await user.click(
      within(metadataCard).getByRole("button", { name: "Add metadata" }),
    );
    fireEvent.change(
      within(metadataCard).getByRole("textbox", {
        name: "Custom metadata key 1",
      }),
      { target: { value: "owner" } },
    );
    await user.click(
      within(metadataCard).getByRole("button", { name: "Remove custom metadata 1" }),
    );

    const tagsCard = screen.getByRole("form", { name: "Tags" });
    await user.click(within(tagsCard).getByRole("button", { name: "Add tag" }));
    fireEvent.change(
      within(tagsCard).getByRole("textbox", { name: "Tags value 1" }),
      { target: { value: "production" } },
    );
    await user.click(
      within(tagsCard).getByRole("button", { name: "Remove tags 1" }),
    );
    await user.click(
      within(tagsCard).getByRole("button", { name: "Save tags" }),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Storage class" }),
      "GLACIER",
    );
    await user.click(
      screen.getByRole("button", { name: "Save storage class" }),
    );

    expect(onMetadataDraftChange).toHaveBeenCalledWith(
      "contentType",
      "application/json",
    );
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onSaveMetadata).toHaveBeenCalledOnce();
    expect(onAddMetadata).toHaveBeenCalledOnce();
    expect(onMetadataItemChange).toHaveBeenCalledWith(
      "meta-1",
      "key",
      "owner",
    );
    expect(onRemoveMetadata).toHaveBeenCalledWith("meta-1");
    expect(onAddTag).toHaveBeenCalledOnce();
    expect(onTagChange).toHaveBeenCalledWith(
      "tag-1",
      "value",
      "production",
    );
    expect(onRemoveTag).toHaveBeenCalledWith("tag-1");
    expect(onSaveTags).toHaveBeenCalledOnce();
    expect(onStorageClassChange).toHaveBeenCalledWith("GLACIER");
    expect(onSaveStorageClass).toHaveBeenCalledOnce();
  });

  it.each([
    ["read-only profile", { readOnly: true }],
    ["loading", { loading: true }],
    ["initial read failure", { loaded: false, error: "Read denied" }],
    ["metadata save", { savingMetadata: true }],
    ["tag save", { savingTags: true }],
    ["storage class save", { savingStorageClass: true }],
  ] as const)("locks property editing during %s", (_state, overrides) => {
    render(
      <BrowserObjectPropertiesTab
        readOnly={false}
        loading={false}
        loaded
        error={null}
        metadataDraft={metadataDraft}
        onMetadataDraftChange={vi.fn()}
        savingMetadata={false}
        onSaveMetadata={vi.fn()}
        metadataItems={[]}
        onAddMetadata={vi.fn()}
        onMetadataItemChange={vi.fn()}
        onRemoveMetadata={vi.fn()}
        tags={[]}
        onAddTag={vi.fn()}
        onTagChange={vi.fn()}
        onRemoveTag={vi.fn()}
        savingTags={false}
        onSaveTags={vi.fn()}
        storageClass="STANDARD"
        onStorageClassChange={vi.fn()}
        savingStorageClass={false}
        onSaveStorageClass={vi.fn()}
        onRefresh={vi.fn()}
        {...overrides}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Content type" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add tag" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add metadata" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Storage class" })).toBeDisabled();
    for (const form of screen.getAllByRole("form")) {
      expect(within(form).getByRole("button", { name: /^(Save|Saving)/ })).toBeDisabled();
    }
    if ("error" in overrides) {
      expect(screen.getByRole("alert")).toHaveTextContent("Read denied");
      expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    }
    if ("readOnly" in overrides) expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("locks the archive draft until the request settles and permits retry with retained values", async () => {
    const user = userEvent.setup();
    const props = { days: "14", tier: "Bulk" as const, onDaysChange: vi.fn(), onTierChange: vi.fn(), onRestore: vi.fn() };
    const { rerender } = render(<BrowserObjectArchiveTab {...props} saving />);
    expect(screen.getByLabelText("Days")).toBeDisabled();
    expect(screen.getByLabelText("Tier")).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Archive restore" }));
    expect(props.onRestore).not.toHaveBeenCalled();
    rerender(<BrowserObjectArchiveTab {...props} saving={false} />);
    expect(screen.getByLabelText("Days")).toHaveValue(14);
    expect(screen.getByLabelText("Tier")).toHaveValue("Bulk");
    await user.click(screen.getByLabelText("Days"));
    await user.keyboard("{Enter}");
    expect(props.onRestore).toHaveBeenCalledOnce();
  });

  it("forwards access controls and disables unavailable Object Lock actions", async () => {
    const user = userEvent.setup();
    const onAclChange = vi.fn();
    const onSaveAcl = vi.fn();
    const onGeneratePresign = vi.fn();
    const onCopyPresign = vi.fn();
    const baseProps = {
      aclValue: "private",
      legalHoldError: null,
      legalHoldStatus: "OFF" as const,
      objectLockUnavailable: true,
      onAclChange,
      onCopyPresign,
      onGeneratePresign,
      onLegalHoldStatusChange: vi.fn(),
      onPresignExpiresChange: vi.fn(),
      onRetentionBypassChange: vi.fn(),
      onRetentionDateChange: vi.fn(),
      onRetentionModeChange: vi.fn(),
      onSaveAcl,
      onSaveLegalHold: vi.fn(),
      onSaveRetention: vi.fn(),
      presignError: null,
      presignExpires: "2026-08-26T12:00",
      presignHeaders: { "x-amz-server-side-encryption-customer-key": "key" },
      presignMethod: "GET",
      presignUrl: "https://objects.example.test/report.txt",
      protectionLoading: false,
      retentionBypass: false,
      retentionDate: "",
      retentionError: null,
      retentionMode: "" as ObjectRetentionMode,
      savingAcl: false,
      savingLegalHold: false,
      savingPresign: false,
      savingRetention: false,
      sseCustomerKeyActive: true,
    };
    const { rerender } = render(<BrowserObjectProtectionTab {...baseProps} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Canned ACL" }),
      "public-read",
    );
    await user.click(screen.getByRole("button", { name: "Save ACL" }));
    await user.click(screen.getByRole("button", { name: "Generate URL" }));
    await user.click(screen.getByRole("button", { name: "Copy URL" }));

    expect(onAclChange).toHaveBeenCalledWith("public-read");
    expect(onSaveAcl).toHaveBeenCalledOnce();
    expect(onGeneratePresign).toHaveBeenCalledOnce();
    expect(onCopyPresign).toHaveBeenCalledOnce();
    expect(screen.getAllByText(OBJECT_LOCK_DISABLED_MESSAGE)).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Update legal hold" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Update retention" }),
    ).toBeDisabled();
    expect(screen.getByText(/SSE-C is active/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Required headers" })).toHaveValue(
      JSON.stringify(baseProps.presignHeaders, null, 2),
    );
    expect(screen.getByRole("textbox", { name: "Signed URL" })).toHaveValue(baseProps.presignUrl);

    rerender(<BrowserObjectProtectionTab {...baseProps} objectLockUnavailable={false}
      savingAcl savingLegalHold savingRetention savingPresign />);
    for (const name of ["Canned ACL", "Legal hold status", "Mode"]) {
      expect(screen.getByRole("combobox", { name })).toBeDisabled();
    }
    expect(screen.getByLabelText("Retain until")).toBeDisabled();
    expect(screen.getByLabelText("Expires at")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Bypass governance retention" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Access" }));
    fireEvent.submit(screen.getByRole("form", { name: "Signed URL" }));
    expect(onSaveAcl).toHaveBeenCalledOnce();
    expect(onGeneratePresign).toHaveBeenCalledOnce();
  });
});
