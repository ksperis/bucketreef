import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BucketLifecycleFeature from "../BucketLifecycleFeature";
import { useBucketLifecycleController } from "../useBucketLifecycleController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketLifecycle: vi.fn(),
  getBucketLifecycle: vi.fn(),
  putBucketLifecycle: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketLifecycle: (...args: unknown[]) => apiMocks.deleteBucketLifecycle(...args),
  getBucketLifecycle: (...args: unknown[]) => apiMocks.getBucketLifecycle(...args),
  putBucketLifecycle: (...args: unknown[]) => apiMocks.putBucketLifecycle(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketLifecycle: vi.fn(),
  getCephAdminBucketLifecycle: vi.fn(),
  putCephAdminBucketLifecycle: vi.fn(),
}));

function LifecycleHarness() {
  const controller = useBucketLifecycleController({
    accountId: "acc-1",
    bucketName: "reports",
    cephAdmin: false,
    enabled: true,
    endpointId: null,
  });
  const { load } = controller;
  useEffect(() => {
    void load();
  }, [load]);
  return <BucketLifecycleFeature controller={controller} />;
}

function renderLifecycleFeature() {
  return render(
    <MemoryRouter>
      <LifecycleHarness />
    </MemoryRouter>,
  );
}

describe("BucketLifecycleFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses native Visual validation before the transactional Save boundary", async () => {
    apiMocks.getBucketLifecycle.mockResolvedValue({
      rules: [
        {
          ID: "expire-logs",
          Status: "Enabled",
          Filter: { Prefix: "logs/" },
          Expiration: { Days: 30 },
          Transitions: [{ Days: 7, StorageClass: "STANDARD_IA" }],
        },
      ],
    });
    const user = userEvent.setup();
    renderLifecycleFeature();

    const section = await screen.findByTestId("bucket-feature-lifecycle");
    await waitFor(() => expect(within(section).getByText("expire-logs")).toBeInTheDocument());
    await user.click(within(section).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog", { name: "Edit lifecycle rules" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    const expirationDays = within(dialog).getByLabelText("Expire current objects after (days)");
    fireEvent.change(expirationDays, { target: { value: "-1" } });
    expect(expirationDays).toBeInvalid();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit lifecycle rules" })).toBeVisible();

    const currentTransition = within(dialog)
      .getByText("Current version transition")
      .closest("details") as HTMLElement;
    const transitionDays = within(currentTransition).getByLabelText("Days");
    const storageClass = within(currentTransition).getByLabelText("Storage class");
    fireEvent.change(expirationDays, { target: { value: "30" } });
    fireEvent.change(transitionDays, { target: { value: "7" } });
    fireEvent.change(storageClass, { target: { value: "" } });
    expect(storageClass).toBeRequired();
    expect(storageClass).toBeInvalid();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
  });

  it("renders the empty collection and opens an incomplete new rule with Save disabled", async () => {
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [] });
    const user = userEvent.setup();
    renderLifecycleFeature();

    const section = await screen.findByTestId("bucket-feature-lifecycle");
    expect(within(section).getByRole("table")).toBeInTheDocument();
    expect(within(section).getByText("0 rules")).toBeInTheDocument();
    expect(within(section).getByText("No rules configured on this bucket.")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Add rule", exact: true }));

    const dialog = screen.getByRole("dialog", { name: "Edit lifecycle rules" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).getByText("Add at least one lifecycle action before saving this rule.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("warns before deleting the final configuration and supports Undo inside the draft", async () => {
    apiMocks.getBucketLifecycle.mockResolvedValue({
      rules: [
        {
          ID: "expire-logs",
          Status: "Enabled",
          Expiration: { Days: 30 },
        },
      ],
    });
    const user = userEvent.setup();
    renderLifecycleFeature();

    const section = await screen.findByTestId("bucket-feature-lifecycle");
    await waitFor(() => expect(within(section).getByText("expire-logs")).toBeInTheDocument());
    await user.click(within(section).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit lifecycle rules" });
    await user.click(within(dialog).getByRole("button", { name: "Remove rule" }));

    expect(
      within(dialog).getByText("Saving will remove the Lifecycle configuration from this bucket."),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Undo" }));
    expect(within(dialog).getByText("expire-logs")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
