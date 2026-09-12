import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BucketConfigBackupModal, { type BucketConfigBackupFeatureOption } from "./BucketConfigBackupModal";

const baseFeatureOptions: BucketConfigBackupFeatureOption[] = [
  { key: "quota", label: "Quota", available: true },
  { key: "versioning", label: "Versioning", available: true },
  { key: "policy", label: "Bucket policy", available: true },
];

describe("BucketConfigBackupModal", () => {
  it("keeps choices across refreshed capabilities and never submits unavailable features", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const props = { bucketCount: 2, onClose: vi.fn(), onCreate };
    const { rerender } = render(<BucketConfigBackupModal {...props} featureOptions={baseFeatureOptions} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Quota" }));
    rerender(<BucketConfigBackupModal {...props} featureOptions={baseFeatureOptions.map(feature => ({
      ...feature, available: feature.key !== "policy",
    }))} />);
    expect(screen.getByRole("checkbox", { name: "Quota" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket policy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["versioning"]));
  });

  it("protects edited choices when closing and retains them after keeping the draft", () => {
    const onClose = vi.fn();
    render(<BucketConfigBackupModal bucketCount={2} featureOptions={baseFeatureOptions}
      onClose={onClose} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Quota" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("checkbox", { name: "Quota" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("freezes the draft and closing during download, then retains choices for a retry", async () => {
    let reject!: (error: Error) => void;
    const onCreate = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }))
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<BucketConfigBackupModal bucketCount={2} featureOptions={baseFeatureOptions}
      onClose={onClose} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Quota" }));
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    fireEvent.submit(screen.getByRole("form", { name: "Backup bucket configs" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("checkbox", { name: "Versioning" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreate).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Temporary backup failure")));
    expect(screen.getByRole("alert")).toHaveTextContent("Temporary backup failure");
    expect(screen.getByRole("checkbox", { name: "Quota" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls).toEqual([[ ["versioning", "policy"] ], [ ["versioning", "policy"] ]]);
  });

  it("checks available features by default and submits them", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <BucketConfigBackupModal
        bucketCount={2}
        featureOptions={baseFeatureOptions}
        onClose={onClose}
        onCreate={onCreate}
      />
    );

    expect(screen.getByRole("checkbox", { name: "Quota" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Versioning" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket policy" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["quota", "versioning", "policy"]));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("grays unavailable features and omits them from the request", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <BucketConfigBackupModal
        bucketCount={1}
        featureOptions={[
          { key: "quota", label: "Quota", available: false, unavailableReason: "Bucket stats unavailable" },
          { key: "tags", label: "Tags", available: true },
        ]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />
    );

    expect(screen.getByRole("checkbox", { name: /Quota/ })).toBeDisabled();
    expect(screen.getByText("Bucket stats unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["tags"]));
  });

  it("shows a readable error when backup creation fails", async () => {
    render(
      <BucketConfigBackupModal
        bucketCount={1}
        featureOptions={baseFeatureOptions}
        onClose={vi.fn()}
        onCreate={vi.fn().mockRejectedValue(new Error("endpoint denied"))}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    expect(await screen.findByText("endpoint denied")).toBeInTheDocument();
  });
});
