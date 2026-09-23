/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type BucketConfigurationDeleteKind =
  | "cors"
  | "encryption"
  | "tags"
  | "notifications"
  | "replication"
  | "website"
  | "policy"
  | "access-logging";

export const bucketConfigurationDeleteCopy: Record<
  BucketConfigurationDeleteKind,
  { title: string; description: string; confirmLabel: string; impacts: string[] }
> = {
  cors: {
    title: "Delete CORS configuration?",
    description: "Remove all cross-origin access rules from this bucket.",
    confirmLabel: "Delete CORS configuration",
    impacts: ["Browser-based clients may no longer be able to access objects across origins."],
  },
  encryption: {
    title: "Disable default bucket encryption?",
    description: "Remove the default server-side encryption rules for new objects.",
    confirmLabel: "Disable encryption",
    impacts: ["Existing objects remain encrypted. New objects will no longer inherit this bucket default."],
  },
  tags: {
    title: "Clear all bucket tags?",
    description: "Remove every key/value tag attached to this bucket.",
    confirmLabel: "Clear tags",
    impacts: ["Automation or access rules that rely on bucket tags may stop matching this bucket."],
  },
  notifications: {
    title: "Clear notification configuration?",
    description: "Remove every event notification configured for this bucket.",
    confirmLabel: "Clear notifications",
    impacts: ["New bucket events will no longer be delivered to the configured destinations."],
  },
  replication: {
    title: "Clear replication configuration?",
    description: "Remove the replication rules configured for this bucket.",
    confirmLabel: "Clear replication",
    impacts: ["New object changes will stop replicating. Existing destination objects will remain."],
  },
  website: {
    title: "Delete static website configuration?",
    description: "Stop hosting or redirecting requests through this bucket's website endpoint.",
    confirmLabel: "Delete website configuration",
    impacts: ["Website routing will stop. Objects stored in the bucket will not be deleted."],
  },
  policy: {
    title: "Delete bucket policy?",
    description: "Remove the IAM-style resource policy attached directly to this bucket.",
    confirmLabel: "Delete bucket policy",
    impacts: ["Access granted only by this policy will be revoked. IAM and ACL permissions remain unchanged."],
  },
  "access-logging": {
    title: "Disable server access logging?",
    description: "Stop delivering new server access logs for this bucket.",
    confirmLabel: "Disable access logging",
    impacts: ["Existing log objects remain in the target bucket, but no new access logs will be delivered."],
  },
};

export const defaultLifecycleJsonExample = `[
  {
    "ID": "expire-logs",
    "Status": "Enabled",
    "Filter": { "Prefix": "logs/" },
    "Expiration": { "Days": 30 }
  }
]`;

export const defaultReplicationJsonExample = `{
  "Role": "arn:aws:iam::123456789012:role/replication-role",
  "Rules": [
    {
      "ID": "rule-1",
      "Status": "Enabled",
      "Priority": 1,
      "Filter": { "Prefix": "logs/" },
      "Destination": { "Bucket": "arn:aws:s3:::target-bucket" },
      "DeleteMarkerReplication": { "Status": "Disabled" }
    }
  ]
}`;
