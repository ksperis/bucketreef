# Object Operations from Ceph Admin

Ceph Admin can expose an embedded Browser for authorized object-level work on
the selected Ceph RGW endpoint.

## Before you start

- Select the intended Ceph Admin endpoint.
- Confirm that your administrator access includes the Browser action for that
  endpoint and target bucket.
- Distinguish S3 object operations from **RGW Admin Ops**. They use different
  administrative paths and safety rules.

## Main tasks

1. Open the Browser action from Ceph Admin for the intended bucket/context.
2. Navigate to the exact prefix or object.
3. Use the available S3 object actions for inspection or controlled data work.
4. Use version history when the bucket is versioned and the endpoint can list
   versions.
5. For RGW ownership, bucket-index, account/user deletion, or other Admin Ops
   work, return to the Ceph Admin administrative action rather than treating the
   embedded Browser as an RGW Admin console.

Object operations remain subject to the authorization path selected by Ceph
Admin. Review failures before retrying, especially after a destructive action.

## Related pages

- [Ceph Admin](ceph-admin/index.md)
- [Object versions](browser-versions.md)
- [Safe operations](safe-operations.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-objects-browser.light.png" alt="Object operations available from an administrative storage context" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-objects-browser.dark.png" alt="Object operations available from an administrative storage context" loading="lazy">
</div>
