/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import type { BucketCompareContentDiff } from "../../api/bucketCompareContracts";
import type { CompareObjectDetailLike } from "./BucketCompareObjectDetails";

type CompareObjectDiffLike = {
  key: string;
  source_size: number | null;
  target_size: number | null;
  source_etag: string | null;
  target_etag: string | null;
  source_last_modified: string | null;
  target_last_modified: string | null;
  source_storage_class: string | null;
  target_storage_class: string | null;
};

export type CompareVisibleKeysCopyFeedback = {
  tone: "success" | "danger";
  message: string;
};

export type BucketCompareContentSection = {
  key: "source_only" | "target_only" | "different";
  changed: boolean;
  objectCount: number;
  visibleCount: number;
  hiddenCount: number;
  copyKeys: string[];
  sourceDetails: CompareObjectDetailLike[];
  targetDetails: CompareObjectDetailLike[];
};

export const getObjectParentPrefix = (key: string): string => {
  const index = key.lastIndexOf("/");
  if (index < 0) return "";
  return key.slice(0, index + 1);
};

export const sourceCompareObjectDetailFromDiff = (
  diff: CompareObjectDiffLike,
): CompareObjectDetailLike => ({
  key: diff.key,
  size: diff.source_size,
  etag: diff.source_etag,
  last_modified: diff.source_last_modified,
  storage_class: diff.source_storage_class,
});

export const targetCompareObjectDetailFromDiff = (
  diff: CompareObjectDiffLike,
): CompareObjectDetailLike => ({
  key: diff.key,
  size: diff.target_size,
  etag: diff.target_etag,
  last_modified: diff.target_last_modified,
  storage_class: diff.target_storage_class,
});

const getVisibleCompareObjectKeys = (rows: CompareObjectDetailLike[]): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    keys.push(row.key);
  });
  return keys;
};

const getCompareHiddenCount = (
  totalCount: number,
  visibleCount: number,
  hiddenCount?: number | null,
): number => {
  const reportedHiddenCount =
    typeof hiddenCount === "number" && Number.isFinite(hiddenCount)
      ? hiddenCount
      : totalCount - visibleCount;
  return Math.max(0, reportedHiddenCount);
};

export const buildBucketCompareContentSections = (
  content: BucketCompareContentDiff,
): BucketCompareContentSection[] => {
  const onlySourceDetails =
    content.only_source_count > 0 ? content.only_source_details : [];
  const onlyTargetDetails =
    content.only_target_count > 0 ? content.only_target_details : [];
  const differentSourceDetails =
    content.different_count > 0
      ? content.different_sample.map(sourceCompareObjectDetailFromDiff)
      : [];
  const differentTargetDetails =
    content.different_count > 0
      ? content.different_sample.map(targetCompareObjectDetailFromDiff)
      : [];

  return [
    {
      key: "source_only",
      changed: content.only_source_count > 0,
      objectCount: content.only_source_count,
      visibleCount: onlySourceDetails.length,
      hiddenCount: getCompareHiddenCount(
        content.only_source_count,
        onlySourceDetails.length,
        content.only_source_hidden_count,
      ),
      copyKeys: getVisibleCompareObjectKeys(onlySourceDetails),
      sourceDetails: onlySourceDetails,
      targetDetails: [],
    },
    {
      key: "target_only",
      changed: content.only_target_count > 0,
      objectCount: content.only_target_count,
      visibleCount: onlyTargetDetails.length,
      hiddenCount: getCompareHiddenCount(
        content.only_target_count,
        onlyTargetDetails.length,
        content.only_target_hidden_count,
      ),
      copyKeys: getVisibleCompareObjectKeys(onlyTargetDetails),
      sourceDetails: [],
      targetDetails: onlyTargetDetails,
    },
    {
      key: "different",
      changed: content.different_count > 0,
      objectCount: content.different_count,
      visibleCount: differentSourceDetails.length,
      hiddenCount: getCompareHiddenCount(
        content.different_count,
        differentSourceDetails.length,
        content.different_hidden_count,
      ),
      copyKeys: getVisibleCompareObjectKeys(differentSourceDetails),
      sourceDetails: differentSourceDetails,
      targetDetails: differentTargetDetails,
    },
  ];
};

export const formatCompareDisplayLimitMessage = (
  totalCount: number,
  visibleCount: number,
  hiddenCount?: number | null,
): string | null => {
  const hidden = getCompareHiddenCount(totalCount, visibleCount, hiddenCount);
  if (hidden <= 0) return null;
  return `Showing ${visibleCount} of ${totalCount} objects. ${hidden} not displayed.`;
};

const copyCompareObjectKeysToClipboard = async (keys: string[]): Promise<void> => {
  const clipboard =
    typeof window !== "undefined"
      ? window.navigator.clipboard
      : typeof navigator !== "undefined"
        ? navigator.clipboard
        : null;
  if (!clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await clipboard.writeText(keys.join("\n"));
};

export const useCompareVisibleKeysClipboard = () => {
  const [copyFeedback, setCopyFeedback] = useState<
    (CompareVisibleKeysCopyFeedback & { id: string }) | null
  >(null);
  const copyVisibleKeys = useCallback(async (id: string, keys: string[]) => {
    if (keys.length === 0) return;
    try {
      await copyCompareObjectKeysToClipboard(keys);
      setCopyFeedback({
        id,
        tone: "success",
        message: `Copied ${keys.length} key${keys.length === 1 ? "" : "s"} to clipboard.`,
      });
    } catch {
      setCopyFeedback({
        id,
        tone: "danger",
        message: "Unable to copy keys to clipboard.",
      });
    }
  }, []);

  return { copyFeedback, copyVisibleKeys };
};
