import { type ReactNode } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCephAdminBucketObjects } from "../../../../api/cephAdminBucketDetails";
import { listCephAdminBuckets } from "../../../../api/cephAdminBuckets";
import { listBuckets } from "../../../../api/managerBuckets";
import { listManagerObjects } from "../../../../api/managerObjects";
import { listTopics } from "../../../../api/topics";
import {
  BucketFeatureSuggestionsProvider,
  useBucketFeatureSuggestions,
} from "../BucketFeatureSuggestions";

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  listCephAdminBucketObjects: vi.fn(),
}));
vi.mock("../../../../api/cephAdminBuckets", () => ({
  listCephAdminBuckets: vi.fn(),
}));
vi.mock("../../../../api/managerBuckets", () => ({
  listBuckets: vi.fn(),
}));
vi.mock("../../../../api/managerObjects", () => ({
  listManagerObjects: vi.fn(),
}));
vi.mock("../../../../api/topics", () => ({
  listTopics: vi.fn(),
}));

const listManagerObjectsMock = vi.mocked(listManagerObjects);
const listCephAdminBucketObjectsMock = vi.mocked(listCephAdminBucketObjects);
const listBucketsMock = vi.mocked(listBuckets);
const listCephAdminBucketsMock = vi.mocked(listCephAdminBuckets);
const listTopicsMock = vi.mocked(listTopics);

function managerWrapper({ children }: { children: ReactNode }) {
  return (
    <BucketFeatureSuggestionsProvider
      accountId="acc-1"
      bucketName="Source + Bucket"
      cephAdmin={false}
      enabled
      endpointId={null}
      topicsEnabled
    >
      {children}
    </BucketFeatureSuggestionsProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listManagerObjectsMock.mockResolvedValue({
    prefix: "",
    objects: [],
    prefixes: [],
    is_truncated: false,
    next_continuation_token: null,
  });
  listBucketsMock.mockResolvedValue([]);
  listTopicsMock.mockResolvedValue([]);
  listCephAdminBucketObjectsMock.mockResolvedValue({
    prefix: "",
    objects: [],
    prefixes: [],
    is_truncated: false,
    next_continuation_token: null,
  });
  listCephAdminBucketsMock.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
    has_next: false,
  });
});

describe("BucketFeatureSuggestionsProvider", () => {
  it("preserves literal S3 prefixes and derives observed suffixes and storage classes", async () => {
    listManagerObjectsMock.mockResolvedValueOnce({
      prefix: "Raw +/",
      objects: [
        {
          key: "Raw +/Report Final.JSON",
          size: 12,
          storage_class: "RGW_CUSTOM",
        },
      ],
      prefixes: ["Raw +/Nested +/"],
      is_truncated: false,
      next_continuation_token: null,
    });

    const { result } = renderHook(() => useBucketFeatureSuggestions(), {
      wrapper: managerWrapper,
    });

    let prefixes: Awaited<ReturnType<NonNullable<typeof result.current.prefixes.loadSuggestions>>> = [];
    await act(async () => {
      prefixes = await result.current.prefixes.loadSuggestions!("Raw +/");
    });

    expect(listManagerObjectsMock).toHaveBeenCalledWith(
      "acc-1",
      "Source + Bucket",
      "Raw +/",
    );
    expect(prefixes.map((entry) => entry.value)).toEqual(["Raw +/Nested +/"]);
    await waitFor(() => {
      expect(result.current.storageClasses.suggestions?.map((entry) => entry.value)).toContain("RGW_CUSTOM");
      expect(result.current.suffixes.suggestions?.map((entry) => entry.value)).toContain(".JSON");
    });

    const resources = await result.current.policyResources.loadSuggestions!(
      "arn:aws:s3:::Source + Bucket/Raw +/",
    );
    expect(resources.map((entry) => entry.value)).toEqual([
      "arn:aws:s3:::Source + Bucket/Raw +/Nested +/*",
    ]);
  });

  it("loads buckets and topics lazily, caches catalogue requests, and swallows suggestion errors", async () => {
    listBucketsMock.mockResolvedValue([
      { name: "logs-target" },
      { name: "archive-target" },
    ]);
    listTopicsMock.mockResolvedValue([
      {
        name: "events-main",
        arn: "arn:aws:sns:default:acc-1:events-main",
        configuration: null,
      },
    ]);
    listManagerObjectsMock.mockRejectedValueOnce(new Error("listing unavailable"));

    const { result } = renderHook(() => useBucketFeatureSuggestions(), {
      wrapper: managerWrapper,
    });

    expect(listBucketsMock).not.toHaveBeenCalled();
    expect(listTopicsMock).not.toHaveBeenCalled();

    const buckets = await result.current.buckets.loadSuggestions!("");
    const bucketArns = await result.current.destinationBucketArns.loadSuggestions!("arn:aws:s3:::logs");
    expect(buckets.map((entry) => entry.value)).toEqual(["logs-target", "archive-target"]);
    expect(bucketArns.map((entry) => entry.value)).toEqual([
      "arn:aws:s3:::logs-target",
      "arn:aws:s3:::archive-target",
    ]);
    expect(listBucketsMock).toHaveBeenCalledTimes(1);

    const topics = await result.current.topicArns.loadSuggestions!("");
    await result.current.topicArns.loadSuggestions!("events");
    expect(topics[0]).toMatchObject({
      label: "events-main",
      value: "arn:aws:sns:default:acc-1:events-main",
    });
    expect(listTopicsMock).toHaveBeenCalledTimes(1);

    await expect(result.current.prefixes.loadSuggestions!("broken +/")).resolves.toEqual([]);
  });

  it("uses Ceph Admin object and bucket discovery without exposing Manager topic discovery", async () => {
    listCephAdminBucketObjectsMock.mockResolvedValueOnce({
      prefix: "logs/",
      objects: [],
      prefixes: ["logs/2026/"],
      is_truncated: false,
      next_continuation_token: null,
    });
    listCephAdminBucketsMock.mockResolvedValueOnce({
      items: [{ name: "ceph-target" }],
      total: 1,
      page: 1,
      page_size: 50,
      has_next: false,
    });

    function wrapper({ children }: { children: ReactNode }) {
      return (
        <BucketFeatureSuggestionsProvider
          accountId={null}
          bucketName="ceph-source"
          cephAdmin
          enabled
          endpointId={7}
          topicsEnabled
        >
          {children}
        </BucketFeatureSuggestionsProvider>
      );
    }

    const { result } = renderHook(() => useBucketFeatureSuggestions(), { wrapper });
    const prefixes = await result.current.prefixes.loadSuggestions!("logs/");
    const buckets = await result.current.buckets.loadSuggestions!("ceph");

    expect(prefixes.map((entry) => entry.value)).toEqual(["logs/2026/"]);
    expect(listCephAdminBucketObjectsMock).toHaveBeenCalledWith(7, "ceph-source", "logs/");
    expect(buckets.map((entry) => entry.value)).toEqual(["ceph-target"]);
    expect(listCephAdminBucketsMock).toHaveBeenCalledWith(7, {
      filter: "ceph",
      page: 1,
      page_size: 50,
      with_stats: false,
    });
    expect(result.current.topicArns.loadSuggestions).toBeUndefined();
    expect(listTopicsMock).not.toHaveBeenCalled();
  });

  it("ignores object results that resolve after the provider context changes", async () => {
    let resolveOld: ((value: Awaited<ReturnType<typeof listManagerObjects>>) => void) | undefined;
    listManagerObjectsMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    listManagerObjectsMock.mockResolvedValueOnce({
      prefix: "new/",
      objects: [],
      prefixes: ["new/current/"],
      is_truncated: false,
      next_continuation_token: null,
    });

    let current = null as ReturnType<typeof useBucketFeatureSuggestions> | null;
    function Consumer() {
      current = useBucketFeatureSuggestions();
      return null;
    }
    const view = render(
      <BucketFeatureSuggestionsProvider
        accountId="acc-old"
        bucketName="old-bucket"
        cephAdmin={false}
        enabled
        endpointId={null}
        topicsEnabled
      >
        <Consumer />
      </BucketFeatureSuggestionsProvider>,
    );

    const pending = current!.prefixes.loadSuggestions!("old/");
    view.rerender(
      <BucketFeatureSuggestionsProvider
        accountId="acc-new"
        bucketName="new-bucket"
        cephAdmin={false}
        enabled
        endpointId={null}
        topicsEnabled
      >
        <Consumer />
      </BucketFeatureSuggestionsProvider>,
    );
    await act(async () => undefined);

    resolveOld?.({
      prefix: "old/",
      objects: [],
      prefixes: ["old/stale/"],
      is_truncated: false,
      next_continuation_token: null,
    });
    await expect(pending).resolves.toEqual([]);

    const fresh = await current!.prefixes.loadSuggestions!("new/");
    expect(fresh.map((entry) => entry.value)).toEqual(["new/current/"]);
  });
});
