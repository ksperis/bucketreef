/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */

export const ADMIN_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-admin" \\',
  '  --display-name="BucketReef Admin Ops" \\',
  '  --caps="users=read,write;accounts=read,write;buckets=write"',
].join("\n");

export const SUPERVISION_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-supervision" \\',
  '  --display-name="BucketReef Supervision Ops" \\',
  '  --caps="usage=read;buckets=read"',
].join("\n");

export const CEPH_ADMIN_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-ceph-admin" \\',
  '  --display-name="BucketReef Ceph Admin" \\',
  "  --admin",
].join("\n");

export const PRIVATE_S3_USER_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="bkr-user" \\',
  '  --display-name="BucketReef private S3 user"',
].join("\n");
