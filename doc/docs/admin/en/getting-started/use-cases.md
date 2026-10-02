# Administration Use Cases

Use these examples to identify the Administration section that owns an
operational responsibility.

## Deploy a new instance

Start with the local quickstart for evaluation, then use Docker Compose or Helm
for the intended deployment model. Complete authentication hardening,
observability, backup, and production-readiness checks before opening access.

## Add a storage backend

Configure the endpoint in Admin, verify health and capabilities, then create or
import the accounts/connections that BucketReef should expose. Assign UI access
separately from storage-side permissions.

## Delegate a storage project

Create the required platform user/group relationships and account associations.
For Portal, assign `portal_user` or `portal_manager` explicitly. For Manager,
assign `account_administrator` independently when account administration is
required. Validate the resulting access with the effective-access audit.

## Operate Ceph RGW

Use Ceph Admin for cluster-level RGW account, user, bucket, index, and metrics
work. Keep its administrative credentials and destructive actions separate from
normal Manager S3/IAM workflows.

## Run a cross-context operation

Use Storage Ops for authorized bucket sets spanning multiple contexts. Review
filters and target counts before any bulk or destructive action.

## Investigate an incident

Use endpoint status, health checks, observability, application audit, and
backend logs according to the type of failure. Keep storage-side authorization
errors distinct from platform access problems.

## Related pages

- [Admin workspace](../platform/index.md)
- [Ceph Admin](../storage/ceph-admin/index.md)
- [Storage Ops](../storage/storage-ops/index.md)
- [Production readiness](../operations/production-readiness.md)
