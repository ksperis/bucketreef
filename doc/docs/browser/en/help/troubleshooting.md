# Browser Troubleshooting

Use this page when a Browser context, bucket, object operation, preview, or
transfer fails.

## Diagnosis order

1. Confirm the selected Browser context and bucket.
2. Refresh the listing before retrying an operation whose final state is
   uncertain.
3. Open the operation details for uploads, downloads, copy, move, delete, or ZIP
   work and keep the exact S3 error.
4. Check [feature availability](feature-availability.md) if the action is hidden.
5. For direct-transfer failures, check bucket CORS for the BucketReef origin and
   make sure multipart uploads expose `ETag`.

## Common symptoms

| Symptom | First checks |
|---|---|
| Context missing | Private connection ownership/status or Portal project Browser access. |
| Bucket missing | Selected context and S3 bucket-list/read permission. |
| `AccessDenied` | S3 permission for the exact bucket, key, and operation. |
| Upload/download fails in the browser | CORS configuration, network path, operation details; use the configured proxy path when available. |
| Version action missing | Bucket versioning and permission to list versions. |
| Preview falls back to text | File type, preview size limits, or invalid structured content. |
| Copy/move partly failed | Operation details and destination state before retrying. |

Closing or reloading Browser interrupts active transfers. Multipart uploads are
not resumed after returning to the page.

## Report a problem

Include the Browser context, bucket, object key, action, timestamp, and exact
operation error. Do not include secret keys or session tokens.

## Related pages

- [Feature availability](feature-availability.md)
- [Object operations](../objects/operations.md)
- [Object versions](../objects/versions.md)
- [Safe operations](../reference/safe-operations.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/troubleshooting.light.png" alt="Troubleshooting example showing an unavailable storage context" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/troubleshooting.dark.png" alt="Troubleshooting example showing an unavailable storage context" loading="lazy">
</div>
