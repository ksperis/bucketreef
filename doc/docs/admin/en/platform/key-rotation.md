# Feature: Key Rotation in Admin

Use this page when you need to rotate managed storage credentials from Admin.

## When to use

Use **Admin > Settings > Key Rotation** for planned credential rotation, incident response, or validation of endpoint credential hygiene.

## Prerequisites

- `ui_superadmin` access.
- At least one eligible storage endpoint.
- A maintenance window or rollout plan when rotated keys are used by automation.
- A fallback credential or recovery path is known.

## Steps

1. Open **Admin > Settings > Key Rotation**.
2. Select the endpoint or endpoints to rotate.
3. Select only the key types required by the maintenance plan.
4. Choose whether previous keys should be disabled or permanently deleted
   after replacement. Click **Run rotation**, review the endpoints, categories
   and old-key handling, then **Confirm rotation**.
5. Wait for the actual result. Review rotated, failed and skipped entries;
   key identifiers are available in each result's details.
6. Validate endpoint health, Manager context access, Browser access, and any scheduled collection job that uses the rotated credential.
7. Review audit logs for the actor, endpoint, and key type.

## Expected result

Managed credentials are rotated and dependent storage workflows still pass health, usage, and Browser checks.

## You are done when

The rotation result is successful, audit evidence exists, and a post-rotation smoke test passes for every selected endpoint.

## If you do not see this action

Only superadmins can access key rotation. Check role assignment before checking storage endpoint settings.

## Limits / feature flags

!!! warning
    Key rotation can interrupt automation that still depends on an old credential. Validate schedulers, CronJobs, external integrations, and backup access after rotation.

A failed or timed-out request can have a partial outcome. Keep the displayed
results and verify existing keys before starting another rotation. The page
never automatically repeats an uncertain operation.

### Endpoints managed by the environment

Admin Ops and externally supplied Runtime/Supervision credentials remain
operator-managed when an endpoint is configured through `ENV_STORAGE_ENDPOINTS`.
External service identities are never rotated automatically. Ceph Admin is always a
BucketReef-managed identity; managed Runtime, Supervision and Ceph Admin keys are
stored in DB and remain eligible even on an ENV-configured endpoint. Rotation validates
and saves the new key before retiring the old one; pending retirement is retained and
retryable without generating another key.

Managed Runtime, Supervision and Ceph Admin rotations require **delete previous
keys** mode. Selecting **disable previous keys** returns a failure for these
identities before creating a replacement; it remains available for operator-owned
Admin Ops, account and S3 user keys. Deleting the tracked old key is confirmed through
RGW before rotation is reported as complete.

Unexpected keys on a managed identity block rotation and put the identity in `error`.
Only its current key and the tracked previous key during unfinished rotation are
accepted, even when an unexpected key is disabled. Remove unexpected keys externally,
retry service identity configuration, then retry rotation if retirement is pending.
Previously disabled keys left by earlier managed rotations must also be removed by
the operator before the identity can be reconciled or rotated again.

Rotate environment-managed endpoint credentials without interruption:

1. Create a second key for the same RGW identity and keep the old key active.
2. Replace the access key and secret together in the deployment secret or
   configuration that supplies `ENV_STORAGE_ENDPOINTS`.
3. Redeploy every backend replica, then validate Admin Ops and supervision or
   metrics access as applicable. Ceph Admin is reconciled separately as a managed
   identity.
4. Disable or delete the old key only after every replica is using the new
   environment values and the validation checks pass.

Do not retire the old key before the deployment configuration has been updated.
In a multi-replica deployment, do not retire it while any replica may still use
the previous environment.

## Related pages

- [Workspace: Admin](index.md)
- [Ops / Security](../security/index.md)
- [Ops / Production readiness](../operations/production-readiness.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

This page reuses the Admin workspace screenshot because key rotation is a superadmin settings workflow inside Admin.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/workspace-admin.light.png" alt="Admin workspace with platform-level navigation" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/workspace-admin.dark.png" alt="Admin workspace with platform-level navigation" loading="lazy">
</div>
