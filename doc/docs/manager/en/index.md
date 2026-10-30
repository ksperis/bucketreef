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

## RGW multisite destinations

For a managed RGW Account, RGW User, or eligible S3 Connection, BucketReef can
expose an additional S3 endpoint selector when all of the following are true:

- the current context is allowed to switch endpoints: RGW Accounts and RGW Users
  may receive that grant from either the effective UI user/group permission or
  their resource policy and override; S3 Connections use only the effective UI
  user/group permission;
- the current context uses a Ceph endpoint with a declared Realm ID and
  Zonegroup ID;
- at least one other Ceph endpoint declares the same Realm ID and Zonegroup ID.

Changing this selector changes the execution destination only. The selected RGW
Account, RGW User, or S3 Connection remains the logical context and BucketReef
continues to use that context's credentials. Endpoint capabilities such as IAM,
notifications, storage metrics, website configuration, encryption, and
replication follow the selected destination.

The selector shares the topbar destination-control area used by the OpenStack
Region selector. OpenStack project contexts keep their Region selector and do
not support this RGW destination switch. Endpoint-backed S3 Connections can use
the same selector when their workspace access permits it. Connections configured
with a custom URL and connections using temporary session credentials remain
pinned to their original endpoint. Portal, Ceph Admin, Storage Ops, and direct
S3 login sessions are outside this switching flow.

## Manager and Portal are different

`account_administrator` grants Manager access for an account. `portal_manager`
is a Portal role and does not grant access to Manager. A person can hold both
rights, but BucketReef keeps those access axes independent.

## Embedded Browser

Manager can expose an embedded Browser for contexts that explicitly allow data
access. It reuses the active Manager context, including the selected RGW
multisite execution destination. See [object operations](browser/object-operations.md)
and [versions](browser/versions.md) for the behavior inside Manager.

## Next pages

- [Getting started](getting-started/index.md)
- [Common tasks](getting-started/common-tasks.md)
- [Bucket configuration](buckets/configuration.md)
- [IAM access keys](iam/access-keys.md)
- [Feature availability](help/feature-availability.md)
- [Troubleshooting](help/troubleshooting.md)
