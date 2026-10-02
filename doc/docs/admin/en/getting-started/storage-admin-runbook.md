# Storage Administrator Handover Runbook

Use this runbook before giving a team access to a storage service managed through
BucketReef.

## 1. Validate the platform

- Confirm the storage endpoint is healthy and its intended capabilities are
  detected or configured.
- Confirm authentication, backup, scheduler jobs, observability, and audit are
  operational.
- Confirm the workspaces required by the service are enabled.

## 2. Prepare the storage scope

- Create or import the target account, connection, or Ceph RGW resources.
- Apply the intended storage-side IAM/S3 policies and quotas.
- Keep administrative credentials separate from user execution identities.

## 3. Assign BucketReef access

- Give platform users/groups only the workspaces and contexts they need.
- For Manager account access, use `account_administrator`.
- For Portal membership, assign `portal_user` or `portal_manager` explicitly.
- Do not infer one access axis from the other.

## 4. Validate effective access

Use [Effective access audit](../platform/access-audit.md) to confirm the final
user/group/account relationships. Then test the real target workflow with a
representative non-admin user.

## 5. Hand over the right guide

- Account/bucket/IAM administrators: [Manager guide](/manager/en/).
- End users working with Storage Spaces: [Portal guide](/portal/en/).
- Users working directly with object storage contexts: [Browser guide](/browser/en/).

The handover should state the expected workspace, project or context, support
contact, quota/capacity expectations, and which actions require administrator
approval.

## 6. Record operational ownership

Document who owns endpoint credentials, backup/recovery, quota and usage
collection, incident response, and future upgrades. Keep this information in
the service runbook rather than relying on end-user documentation.

## Related pages

- [Sysadmin onboarding](sysadmin-onboarding.md)
- [Production readiness](../operations/production-readiness.md)
- [Feature availability](../help/feature-availability.md)
