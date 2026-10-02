# Manager Guide

Use **Manager** for account-scoped S3 configuration and IAM administration.
Manager keeps the selected execution context explicit and exposes storage
features according to the backend capabilities and your assigned access.

## Start here

1. Open `/manager` and select the account, S3 user, or eligible connection you
   intend to administer.
2. Use [Buckets](buckets/index.md) for bucket configuration and usage.
3. Use [IAM](iam/index.md) for users, groups, roles, and policies when the
   endpoint supports IAM.
4. Use [Topics](topics.md) for SNS topic administration when supported.
5. Use the tools section for compare, integrity, purge, and migration workflows
   that have been enabled for you.

## Manager and Portal are different

`account_administrator` grants Manager access for an account. `portal_manager`
is a Portal role and does not grant access to Manager. A person can hold both
rights, but BucketReef keeps those access axes independent.

## Embedded Browser

Manager can expose an embedded Browser for contexts that explicitly allow data
access. It reuses the active Manager context. See [object operations](browser/object-operations.md)
and [versions](browser/versions.md) for the behavior inside Manager.

## Next pages

- [Getting started](getting-started/index.md)
- [Common tasks](getting-started/common-tasks.md)
- [Bucket configuration](buckets/configuration.md)
- [IAM access keys](iam/access-keys.md)
- [Feature availability](help/feature-availability.md)
- [Troubleshooting](help/troubleshooting.md)
