# Feature Availability

Use this page when a Manager page, context, or action is missing or disabled.

## What Manager checks

Manager combines your BucketReef access with the capabilities and permissions of
the selected execution context. Select the intended context before diagnosing a
missing feature.

| Feature | Check first |
|---|---|
| Manager workspace | Manager is enabled and you have at least one authorized Manager context. |
| Account context | Your account association grants `account_administrator`. A `portal_manager` role does not grant Manager access. |
| S3 connection or S3 user context | The context is assigned to you and enabled for Manager. |
| Buckets | The context can list buckets and the endpoint supports the requested bucket operation. |
| IAM | The endpoint supports IAM and your execution identity can perform the requested IAM action. |
| Access-key management | The selected context and feature settings allow key management for that principal type. |
| Topics | The endpoint exposes SNS support and the execution identity is authorized. |
| Embedded Browser | Data access is enabled for the active Manager context and the context is eligible for Manager Browser. |
| Usage and metrics | The relevant collection or usage feature is enabled for the selected endpoint/context. |
| Compare, integrity, purge, migration | The tool is enabled globally and your direct or inherited Manager access includes that tool. |

## What to do

1. Confirm the context in the Manager topbar.
2. Check whether the missing action is context-specific by opening another
   authorized context only when that comparison is meaningful.
3. Check the endpoint capability shown by BucketReef.
4. If the action is visible but returns `AccessDenied`, treat that as a
   storage-side permission result and review IAM/S3 policy for the selected
   execution identity.
5. Ask a platform administrator to review your effective access when the
   context or tool itself is missing.

## Related pages

- [Start here](../getting-started/index.md)
- [Buckets](../buckets/index.md)
- [IAM](../iam/index.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/start-here.light.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/start-here.dark.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
</div>
