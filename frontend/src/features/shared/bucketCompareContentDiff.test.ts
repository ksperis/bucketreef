import { describe, expect, it } from "vitest";

import {
  buildBucketCompareContentSections,
  sourceCompareObjectDetailFromDiff,
  targetCompareObjectDetailFromDiff,
} from "./bucketCompareContentDiff";

describe("bucket comparison content sections", () => {
  it("builds shared source, target, and changed-object presentation data", () => {
    const sections = buildBucketCompareContentSections({
      source_count: 5,
      target_count: 4,
      matched_count: 2,
      different_count: 1,
      only_source_count: 2,
      only_target_count: 1,
      ignored_after_cutoff_count: 0,
      display_limit: 1,
      only_source_hidden_count: 1,
      only_target_hidden_count: 0,
      different_hidden_count: 0,
      only_source_sample: ["source-a", "source-b"],
      only_target_sample: ["target-a"],
      only_source_details: [
        { key: "source-a", size: 10, etag: "a", last_modified: null, storage_class: null },
      ],
      only_target_details: [
        { key: "target-a", size: 20, etag: "b", last_modified: null, storage_class: null },
      ],
      different_sample: [
        {
          key: "changed",
          source_size: 30,
          target_size: 31,
          source_etag: "c",
          target_etag: "d",
          source_last_modified: null,
          target_last_modified: null,
          source_storage_class: null,
          target_storage_class: null,
          compare_by: "size",
        },
      ],
    });

    expect(sections).toEqual([
      expect.objectContaining({
        key: "source_only",
        objectCount: 2,
        visibleCount: 1,
        hiddenCount: 1,
        copyKeys: ["source-a"],
      }),
      expect.objectContaining({
        key: "target_only",
        objectCount: 1,
        visibleCount: 1,
        hiddenCount: 0,
        copyKeys: ["target-a"],
      }),
      expect.objectContaining({
        key: "different",
        objectCount: 1,
        visibleCount: 1,
        hiddenCount: 0,
        copyKeys: ["changed"],
        sourceDetails: [expect.objectContaining({ key: "changed", size: 30, etag: "c" })],
        targetDetails: [expect.objectContaining({ key: "changed", size: 31, etag: "d" })],
      }),
    ]);
  });
});

describe("bucket comparison object detail projection", () => {
  it("builds fallback and side-specific object details", () => {
    const diff = {
      key: "folder/object.txt",
      source_size: 12,
      target_size: 14,
      source_etag: "source-etag",
      target_etag: "target-etag",
      source_last_modified: "2026-01-01T00:00:00Z",
      target_last_modified: "2026-01-02T00:00:00Z",
      source_storage_class: "STANDARD",
      target_storage_class: "GLACIER",
    };

    expect(sourceCompareObjectDetailFromDiff(diff)).toEqual({
      key: "folder/object.txt",
      size: 12,
      etag: "source-etag",
      last_modified: "2026-01-01T00:00:00Z",
      storage_class: "STANDARD",
    });
    expect(targetCompareObjectDetailFromDiff(diff)).toEqual({
      key: "folder/object.txt",
      size: 14,
      etag: "target-etag",
      last_modified: "2026-01-02T00:00:00Z",
      storage_class: "GLACIER",
    });
  });
});
