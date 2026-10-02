# Feature Availability

Use this page when a Browser context, bucket, or object action is missing.

## What Browser availability depends on

Standalone Browser only shows storage contexts you are allowed to use. The
operations inside a context are then limited by the endpoint capabilities and
the S3 permissions of that context.

| What is missing | Check first |
|---|---|
| Browser workspace | Browser is enabled for your user. |
| A private connection | The connection is active, owned by you, and enabled for Browser. |
| A Portal project context | The project is available to you and Browser access for that Portal context is enabled. |
| A bucket | The selected context can list or open that bucket. |
| Upload, copy, move, or delete | The selected credentials have the required S3 permissions. |
| Direct browser transfer | The bucket CORS configuration allows the BucketReef origin; multipart uploads also need `ETag` exposed. |
| Previous versions | Bucket versioning is enabled and the selected credentials can list versions. |
| Advanced object actions | The Browser profile and endpoint capabilities expose the action. |

Embedded Browser experiences inside Manager, Portal, or Ceph Admin follow their
host workspace rules and are documented in those guides.

## What to do

1. Confirm the selected Browser context and bucket.
2. Refresh the bucket before retrying a write that returned an uncertain result.
3. Read any S3 error shown by the operation. `AccessDenied` means the storage
   identity does not permit the requested action.
4. For upload or download failures, check the transfer details and, when direct
   transfer is used, the bucket CORS configuration.
5. Ask an administrator to review Browser access only when the workspace or
   context itself is missing.

## Related pages

- [Start here](../getting-started/index.md)
- [Object operations](../objects/operations.md)
- [Object versions](../objects/versions.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/start-here.light.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/start-here.dark.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
</div>
