/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type BucketConfigurationDeleteKind =
  | "tags"
  | "website"
  | "access-logging";

export const bucketConfigurationDeleteCopy: Record<
  BucketConfigurationDeleteKind,
  { title: string; description: string; confirmLabel: string; impacts: string[] }
> = {
  tags: {
    title: "Clear all bucket tags?",
    description: "Remove every key/value tag attached to this bucket.",
    confirmLabel: "Clear tags",
    impacts: ["Automation or access rules that rely on bucket tags may stop matching this bucket."],
  },
  website: {
    title: "Delete static website configuration?",
    description: "Stop hosting or redirecting requests through this bucket's website endpoint.",
    confirmLabel: "Delete website configuration",
    impacts: ["Website routing will stop. Objects stored in the bucket will not be deleted."],
  },
  "access-logging": {
    title: "Disable server access logging?",
    description: "Stop delivering new server access logs for this bucket.",
    confirmLabel: "Disable access logging",
    impacts: ["Existing log objects remain in the target bucket, but no new access logs will be delivered."],
  },
};
