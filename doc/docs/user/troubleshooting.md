# Troubleshooting

## When to use

Use this page when a user action fails or an expected menu/page is missing.

## Prerequisites

- Access to your current workspace.
- Ability to report route, context, and error message.

## Steps

1. Verify workspace and context selectors (account/endpoint).
2. Check whether feature is enabled globally (Admin settings).
3. Confirm endpoint capability for the selected context (IAM, browser, sns, metrics).
4. For a failed page load, retry and copy its **Technical details** if needed.
   For a failed write or transfer, check its current state before repeating it.
5. If needed, ask ops/admin to check audit trail and backend logs.

## Quick diagnosis

Error pages offer a recovery action and hide technical information until you
expand **Technical details**. **Copy details** includes the error category, HTTP
status when available, time, and request reference when supplied by the server.
Send those details to your administrator; passwords and URL tokens are not needed.

An error inside an accessible workspace keeps the left navigation. A public-page
error, denied workspace or expired session uses a full page. After a temporary
network/service outage, **Retry** reloads the page or its data. A genuinely ended
session asks you to sign in again. If requests are rate-limited, a countdown may
temporarily disable Retry; returning to the workspace remains available.

| Symptom | First checks | Good report |
|---|---|---|
| Workspace is missing | Role, account links, feature flag, entitlement | User email, expected workspace, current visible workspaces. |
| Bucket or Storage Space is missing | Selected context, account link, visibility, archive state | Workspace, context, missing name, whether other items are visible. |
| Action is disabled or hidden | Feature flag, Manager tool access, Portal role, endpoint capability | Page, selected target, expected action, role or entitlement expected. |
| `AccessDenied` appears | IAM/S3 policy, selected execution identity, object or bucket scope | Exact error, target bucket/key, context, time of action. |
| Metrics are unavailable | Collection jobs, endpoint usage/metrics capability, billing source | Account/context, metric card name, last known collection time if visible. |
| Object version is not visible | Bucket versioning status, deleted marker state, selected object | Bucket, object key, expected version, current Browser context. |

## Expected result

You can identify whether the issue is permission, feature flag, endpoint capability, or operational failure.

## Limits / feature flags

!!! note
    `AccessDenied` from backend is expected behavior when IAM/S3 denies the action.

## Related pages

- [Workspace: Admin](workspace-admin.md)
- [Workspace: Manager](workspace-manager.md)
- [Feature availability](feature-availability.md)
- [Ops / Observability](../ops/operations-observability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/troubleshooting.light.png" alt="Troubleshooting example when no account context is selected" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/troubleshooting.dark.png" alt="Troubleshooting example when no account context is selected" loading="lazy">
</div>
