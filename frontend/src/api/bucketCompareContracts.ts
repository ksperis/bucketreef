/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type BucketCompareConfigFeature =
  | "versioning_status"
  | "object_lock"
  | "public_access_block"
  | "lifecycle_rules"
  | "cors_rules"
  | "bucket_policy"
  | "access_logging"
  | "tags";

export type BucketCompareObjectDetail = {
  key: string;
  size: number | null;
  etag: string | null;
  last_modified: string | null;
  storage_class: string | null;
};

export type BucketCompareObjectDiffEntry = {
  key: string;
  source_size: number | null;
  target_size: number | null;
  source_etag: string | null;
  target_etag: string | null;
  source_last_modified: string | null;
  target_last_modified: string | null;
  source_storage_class: string | null;
  target_storage_class: string | null;
  compare_by: "md5" | "size";
};

export type BucketCompareContentDiff = {
  source_count: number;
  target_count: number;
  matched_count: number;
  different_count: number;
  only_source_count: number;
  only_target_count: number;
  ignored_after_cutoff_count: number;
  display_limit: number;
  only_source_hidden_count: number;
  only_target_hidden_count: number;
  different_hidden_count: number;
  only_source_sample: string[];
  only_target_sample: string[];
  only_source_details: BucketCompareObjectDetail[];
  only_target_details: BucketCompareObjectDetail[];
  different_sample: BucketCompareObjectDiffEntry[];
};

export type BucketCompareConfigDiffSection = {
  key: string;
  label: string;
  source: unknown;
  target: unknown;
  changed: boolean;
};

export type BucketCompareConfigDiff = {
  changed: boolean;
  sections: BucketCompareConfigDiffSection[];
};
