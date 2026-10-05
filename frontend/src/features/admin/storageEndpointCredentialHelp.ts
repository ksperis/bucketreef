/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */

export const ADMIN_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-admin" \\',
  '  --display-name="BucketReef Admin Ops" \\',
  '  --caps="users=read;accounts=read"',
].join("\n");

export const ADMIN_OPS_FULL_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-admin" \\',
  '  --display-name="BucketReef Admin Ops" \\',
  '  --caps="users=read,write;accounts=read,write;buckets=write"',
].join("\n");

export const SUPERVISION_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-supervision" \\',
  '  --display-name="BucketReef Supervision Ops" \\',
  '  --caps="usage=read;buckets=read" --max-buckets=0',
].join("\n");

export const PRIVATE_S3_USER_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-user" \\',
  '  --display-name="BucketReef private S3 user"',
].join("\n");

export const ADMIN_OPS_OPTIONAL_COMMANDS = [
  '# Managed identities and RGW users',
  'radosgw-admin caps add --uid="bkr-admin" --caps="users=write"',
  '# RGW account provisioning and account quotas',
  'radosgw-admin caps add --uid="bkr-admin" --caps="accounts=write"',
  '# Individual bucket quotas',
  'radosgw-admin caps add --uid="bkr-admin" --caps="buckets=write"',
].join("\n");
export const RUNTIME_READ_OPS_COMMAND = [
  'radosgw-admin user create \\',
  '  --uid="bkr-runtime-read" \\',
  '  --display-name="BucketReef Runtime Read Ops" \\',
  '  --caps="accounts=read;user-info-without-keys=read;buckets=read" --max-buckets=0',
].join("\n");
