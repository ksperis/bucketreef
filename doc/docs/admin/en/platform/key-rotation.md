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
results and rerun the same categories to resume their persisted operations. The page
never automatically repeats an uncertain operation.

### Durable rotation and recovery

Admin Ops, Ceph Admin, account interface keys, S3 user interface keys and managed technical keys
use the same endpoint-locked rotation process. The journal stores the intended pair
encrypted before RGW receives the create request. RGW is asked to create exactly
that pair (`generate-key=false`, explicit S3 access/secret keys); a lost response
never generates an additional pair during retry.

- `prepared`: the pair is persisted and may already exist in RGW; the previous key
  remains operational in the database. Retry inspects or creates the same pair.
- `activated`: the replacement passed validation and became operational in the
  database. The previous key may still need retirement. Every retry revalidates the
  replacement before deleting or disabling the old key.

Runtime checks verify read caps and absence of key material. Supervision checks
verify bucket and usage access; Ceph Admin checks verify its dedicated admin flag.
Admin Ops checks verify the required reads and `users=write` needed for rotation.
Account and S3 user checks confirm the matching pair, principal and active key via
Admin Ops, without adding new S3 permission requirements.

A failed result exposes only `rotation_pending` and `rotation_phase`, never the
candidate secret. Retry the same category on the same endpoint and keep the same
retirement mode. Restore unavailable permissions/connectivity first. If the candidate
is disabled, restore it externally and retry; the old key will not be retired while
candidate validation fails. If ownership or unexpected-key drift is reported, inspect
and remove unexpected keys externally. Do not change the endpoint RGW target or
replace its tracked credentials while a rotation is pending.

Completion requires confirmation that the old key is absent or inactive, then removes
the journal. Existing `previous_access_key` retirements migrate into activated journal
entries with the encrypted current secret intact. Downgrade requires completing all
pending rotations first. Back up the database and credential ring together.

Ready managed Runtime/Supervision identities are eligible even when the endpoint's
Admin feature is disabled. Ceph Admin rotation uses its configured external identity,
keeps that identity external, and requires working Admin Ops with `users=write` to
create and retire keys on the same Ceph Admin principal.

### Endpoints managed by the environment

Admin Ops and externally supplied Runtime/Supervision credentials remain
operator-managed when an endpoint is configured through `ENV_STORAGE_ENDPOINTS`.
External Runtime/Supervision identities are never rotated automatically. Ceph Admin
keys configured on editable endpoints can be rotated from this page; Ceph Admin keys
supplied by `ENV_STORAGE_ENDPOINTS` must still be replaced in environment configuration.
Managed Runtime and Supervision keys are
stored in DB and remain eligible even on an ENV-configured endpoint. Rotation validates
and saves the new key before retiring the old one; pending retirement is retained and
retryable without generating another key.

Managed Runtime and Supervision rotations require **delete previous
keys** mode. The UI disables **disable previous keys** when a technical category is selected,
and the API rejects the entire incompatible request before any mutation; it remains available for operator-owned
Admin Ops, account and S3 user keys. Deleting the tracked old key is confirmed through
RGW before rotation is reported as complete.

Unexpected keys on a managed identity block rotation and put the identity in `error`.
Only its current key and the old/new keys tracked in the rotation journal are
accepted, even when an unexpected key is disabled. Remove unexpected keys externally,
retry service identity configuration, then retry rotation if retirement is pending.
Previously disabled keys left by earlier managed rotations must also be removed by
the operator before the identity can be reconciled or rotated again.

Rotate environment-managed endpoint credentials without interruption:

1. Create a second key for the same RGW identity and keep the old key active.
2. Replace the access key and secret together in the deployment secret or
   configuration that supplies `ENV_STORAGE_ENDPOINTS`.
3. Redeploy every backend replica, then validate Admin Ops and supervision or
   metrics access as applicable. Validate the supplied Ceph Admin pair if it changed.
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
