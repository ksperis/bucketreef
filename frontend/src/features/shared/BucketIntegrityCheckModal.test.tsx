import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketIntegrityCheckPayload, BucketIntegrityProgress, BucketIntegrityResult } from "../../api/bucketIntegrity";
import BucketIntegrityCheckModal from "./BucketIntegrityCheckModal";

const streamManagerBucketIntegrityCheckMock = vi.fn();
const streamCephAdminBucketIntegrityCheckMock = vi.fn();
const streamStorageOpsBucketIntegrityCheckMock = vi.fn();

vi.mock("../../api/bucketIntegrity", async () => {
  const actual = await vi.importActual<typeof import("../../api/bucketIntegrity")>("../../api/bucketIntegrity");
  return {
    ...actual,
    streamManagerBucketIntegrityCheck: (...args: unknown[]) => streamManagerBucketIntegrityCheckMock(...args),
    streamCephAdminBucketIntegrityCheck: (...args: unknown[]) => streamCephAdminBucketIntegrityCheckMock(...args),
    streamStorageOpsBucketIntegrityCheck: (...args: unknown[]) => streamStorageOpsBucketIntegrityCheckMock(...args),
  };
});

function buildIntegrityResult(): BucketIntegrityResult {
  return {
    status: "completed_with_errors",
    total_buckets: 2,
    completed_buckets: 2,
    listed_count: 3,
    checked_count: 3,
    failed_count: 1,
    bytes_read: 3072,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:03Z",
    buckets: [
      {
        bucket_name: "bucket-a",
        context_id: "ctx-1",
        context_name: "Context 1",
        status: "completed_with_errors",
        listed_count: 2,
        checked_count: 2,
        failed_count: 1,
        bytes_read: 1024,
        duration_seconds: 1.2,
        failures_sample: [
          {
            bucket_name: "bucket-a",
            stage: "get",
            key: "broken.txt",
            version_id: "v1",
            message: "AccessDenied: denied",
          },
        ],
      },
      {
        bucket_name: "bucket-b",
        context_id: "ctx-1",
        context_name: "Context 1",
        status: "passed",
        listed_count: 1,
        checked_count: 1,
        failed_count: 0,
        bytes_read: 2048,
        duration_seconds: 0.6,
        failures_sample: [],
      },
    ],
  };
}

async function runIntegrityCheck() {
  const user = userEvent.setup();
  render(
    <BucketIntegrityCheckModal
      mode="manager"
      contextId="ctx-1"
      contextName="Context 1"
      targets={[{ bucketName: "bucket-a" }, { bucketName: "bucket-b" }]}
      onClose={() => undefined}
    />
  );
  await user.click(screen.getByRole("button", { name: "Run check" }));
  await waitFor(() => {
    expect(streamManagerBucketIntegrityCheckMock).toHaveBeenCalledTimes(1);
  });
  expect(await screen.findByText("Showing 2 / 2 bucket result(s).")).toBeInTheDocument();
  return user;
}

function closestDetails(element: HTMLElement): HTMLDetailsElement {
  const details = element.closest("details");
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error("Expected element to be inside a details element.");
  }
  return details;
}

describe("BucketIntegrityCheckModal results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamManagerBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
    streamCephAdminBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
    streamStorageOpsBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
  });

  it("renders expandable bucket details with affected object rows", async () => {
    const user = await runIntegrityCheck();

    const bucketDetails = closestDetails(screen.getByText("bucket-a"));
    expect(bucketDetails).not.toHaveAttribute("open");

    await user.click(within(bucketDetails).getByText("bucket-a"));

    expect(bucketDetails).toHaveAttribute("open");
    expect(within(bucketDetails).getByText("Affected objects")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("broken.txt")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("v1")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("AccessDenied: denied")).toBeInTheDocument();
  });

  it("distinguishes missing error details from an error-free bucket", async () => {
    const result = buildIntegrityResult();
    result.buckets[0].failures_sample = [];
    streamManagerBucketIntegrityCheckMock.mockResolvedValueOnce(result);
    const user = await runIntegrityCheck();
    const failedBucket = closestDetails(screen.getByText("bucket-a"));
    await user.click(within(failedBucket).getByText("bucket-a"));
    expect(within(failedBucket).getByText("Only 0 of 1 error(s) are visible.")).toBeInTheDocument();
    expect(within(failedBucket).getByText("Error details are unavailable for this bucket.")).toBeInTheDocument();
    expect(within(failedBucket).queryByText("No affected objects reported for this bucket.")).not.toBeInTheDocument();

    const passedBucket = closestDetails(screen.getByText("bucket-b"));
    await user.click(within(passedBucket).getByText("bucket-b"));
    expect(within(passedBucket).getByText("No affected objects reported for this bucket.")).toBeInTheDocument();
  });

  it("runs HEAD mode by default and GET mode when selected", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <BucketIntegrityCheckModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }]}
        onClose={() => undefined}
      />
    );

    const maxMbInput = screen.getByLabelText("Max MB per object") as HTMLInputElement;
    expect(maxMbInput).toBeDisabled();
    const modeGroup = screen.getByRole("group", { name: "Bucket integrity check mode" });
    expect(within(modeGroup).getByRole("button", { name: "HEAD only" })).toHaveAttribute("aria-pressed", "true");

    const runButton = screen.getByRole("button", { name: "Run check" });
    expect(runButton).toHaveClass("ui-button-base");
    await user.click(runButton);
    await waitFor(() => {
      expect(streamManagerBucketIntegrityCheckMock).toHaveBeenCalledTimes(1);
    });
    let payload = streamManagerBucketIntegrityCheckMock.mock.calls[0][1] as BucketIntegrityCheckPayload;
    expect(payload.check_mode).toBe("head");
    expect(payload.max_mb_per_object).toBeUndefined();

    vi.clearAllMocks();
    streamManagerBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
    rerender(
      <BucketIntegrityCheckModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }]}
        onClose={() => undefined}
      />
    );

    await user.click(within(modeGroup).getByRole("button", { name: "GET body" }));
    expect(within(modeGroup).getByRole("button", { name: "GET body" })).toHaveAttribute("aria-pressed", "true");
    const enabledMaxMbInput = screen.getByLabelText("Max MB per object") as HTMLInputElement;
    expect(enabledMaxMbInput).not.toBeDisabled();
    await user.type(enabledMaxMbInput, "1.5");
    await user.click(screen.getByRole("button", { name: "Run check" }));
    await waitFor(() => {
      expect(streamManagerBucketIntegrityCheckMock).toHaveBeenCalledTimes(1);
    });
    payload = streamManagerBucketIntegrityCheckMock.mock.calls[0][1] as BucketIntegrityCheckPayload;
    expect(payload.check_mode).toBe("get");
    expect(payload.max_mb_per_object).toBe(1.5);
  });

  it.each([true, false])("renders accessible progress with a known total: %s", async (knownTotal) => {
    const progressEvent: BucketIntegrityProgress = {
      request_id: "progress-1",
      stage: "verify",
      bucket_name: "bucket-a",
      context_id: "ctx-1",
      context_name: "Context 1",
      total_buckets: 2,
      completed_buckets: 1,
      listed_count: knownTotal ? 10 : 0,
      checked_count: 5,
      failed_count: 1,
      bytes_read: 2048,
    };
    streamManagerBucketIntegrityCheckMock.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[2] as { onProgress?: (event: BucketIntegrityProgress) => void };
      options.onProgress?.(progressEvent);
      return buildIntegrityResult();
    });

    const user = userEvent.setup();
    render(
      <BucketIntegrityCheckModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }, { bucketName: "bucket-b" }]}
        onClose={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Run check" }));

    expect(await screen.findByText("bucket-a - verify")).toBeInTheDocument();
    expect(screen.getByText(`5 / ${knownTotal ? 10 : 0} objects - 2.0 KB`)).toBeInTheDocument();
    expect(screen.getByText("1 / 2 buckets completed - 1 errors")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Bucket integrity progress" });
    if (knownTotal) {
      expect(bar).toHaveAttribute("aria-valuenow", "50");
    } else {
      expect(bar).not.toHaveAttribute("aria-valuenow");
    }
  });

  it("filters bucket results by object text, status, and error state", async () => {
    const user = await runIntegrityCheck();

    await user.type(screen.getByPlaceholderText("Filter by bucket, context, object, or error"), "broken");
    expect(screen.getByText("Showing 1 / 2 bucket result(s).")).toBeInTheDocument();
    expect(screen.getByText("bucket-a")).toBeInTheDocument();
    expect(screen.queryByText("bucket-b")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await user.selectOptions(screen.getByLabelText("Filter integrity status"), "passed");
    expect(screen.getByText("Showing 1 / 2 bucket result(s).")).toBeInTheDocument();
    expect(screen.getByText("bucket-b")).toBeInTheDocument();
    expect(screen.queryByText("bucket-a")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter integrity status"), "all");
    await user.selectOptions(screen.getByLabelText("Filter integrity errors"), "with_errors");
    expect(screen.getByText("Showing 1 / 2 bucket result(s).")).toBeInTheDocument();
    expect(screen.getByText("bucket-a")).toBeInTheDocument();
    expect(screen.queryByText("bucket-b")).not.toBeInTheDocument();
  });
});
