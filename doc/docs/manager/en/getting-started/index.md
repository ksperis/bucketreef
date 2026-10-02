# Start Here

Use Manager when you administer S3 resources for an application, team, or
assigned storage context.

## First steps

1. Open `/manager`.
2. Select the account, S3 user, or eligible S3 connection you intend to manage.
3. Open [Buckets](../buckets/index.md) to inspect or configure storage.
4. Use [IAM](../iam/index.md) when the selected endpoint supports IAM.
5. Use [Topics](../topics.md) or Manager tools only when those capabilities are
   enabled for your context.

The selected context determines which storage identity executes the operation.
Changing context can change both the visible resources and the permissions of
an action.

## Account access

An account appears in Manager when your effective account association grants
`account_administrator`. A `portal_manager` role belongs to Portal and does not
grant Manager access.

Connections and S3 user contexts follow their own Manager assignments. Some
features, such as embedded Browser data access and destructive tools, require an
additional explicit entitlement.

## Where to continue

| Goal | Read next |
|---|---|
| Create or configure buckets | [Buckets](../buckets/index.md) |
| Manage users, groups, roles, or policies | [IAM](../iam/index.md) |
| Manage delegated access keys | [Access keys](../iam/access-keys.md) |
| Configure SNS topics | [Topics](../topics.md) |
| Work with objects inside Manager | [Embedded Browser](../browser/object-operations.md) |
| Compare, verify, purge, or migrate buckets | [Common tasks](common-tasks.md) |
| Diagnose a missing action | [Feature availability](../help/feature-availability.md) |

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/start-here.light.png" alt="Workspace selector with Manager available" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/start-here.dark.png" alt="Workspace selector with Manager available" loading="lazy">
</div>
