# Feature Availability

Use this page when an administrator needs to understand why a workspace,
feature, or action is not available.

## Availability layers

BucketReef evaluates several independent layers:

1. the workspace or feature is enabled in platform settings;
2. the UI user or group has the required BucketReef role or entitlement;
3. the selected account, connection, S3 user, or endpoint is in scope;
4. the storage endpoint exposes the required capability;
5. the execution identity is authorized by S3, IAM, or Ceph RGW.

A visible UI action does not override the storage-side decision.

## Administrator checks

| Area | Main controls to verify |
|---|---|
| Admin | `ui_admin` or `ui_superadmin` plus the relevant platform setting. |
| Ceph Admin | `ceph_admin_enabled`, a Ceph-compatible endpoint, dedicated Admin Ops credentials, and `can_access_ceph_admin`. |
| Storage Ops | `storage_ops_enabled` and the user's Storage Ops entitlement. |
| Manager | `manager_enabled`, explicit context access, endpoint capabilities, and feature-specific Manager rights. Account access uses `account_administrator`. |
| Portal | `portal_enabled` plus an explicit `portal_user` or `portal_manager` project role. Portal roles are independent from Manager access. |
| Browser | `browser_enabled` plus the Browser rules of the host workspace or standalone context. |
| IAM and topics | Endpoint IAM or SNS capability and the execution identity's permissions. |
| Bucket quotas | Global quota management setting, context permission, and the required endpoint administrative capability. |
| Usage and metrics | Collection jobs, endpoint capabilities, and the corresponding feature settings. |
| Destructive Manager tools | Global tool setting plus the user's direct or inherited Manager tool entitlement. |

## Diagnosis order

1. Reproduce the issue with the same user, workspace, and context.
2. Check the platform setting and effective BucketReef access.
3. Check the endpoint capability advertised for the selected storage backend.
4. If the UI action is available but the request fails, inspect the returned S3,
   IAM, or RGW error before changing BucketReef permissions.
5. Correlate the application audit, endpoint health, and backend logs when the
   failure is operational rather than an authorization denial.

## Related pages

- [Configuration](../configuration/index.md)
- [Effective access audit](../platform/access-audit.md)
- [Endpoint status](../platform/endpoint-status.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/start-here.light.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/start-here.dark.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
</div>
