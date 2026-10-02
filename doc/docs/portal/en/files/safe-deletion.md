# Delete Files Safely

Use this page before removing files from a Portal Storage Space.

## Before deleting

- Confirm the project and Storage Space shown in Portal.
- Check the file or folder name and its path.
- Make sure you are editing the intended space, especially when similarly named
  spaces exist in different projects.
- If the file is important, check whether previous versions are available before
  removing it.

## Delete a file

1. Open the Storage Space and locate the file.
2. Choose the delete action and review the confirmation.
3. Confirm only when the displayed path is the file you intend to remove.
4. Refresh the file list after the operation if its final state is unclear.

If the underlying storage keeps versions, deleting the current file may leave a
recoverable previous version or a delete marker. Use [Previous versions](versions.md)
to inspect what can be restored. When version history is unavailable, Portal
cannot provide an application-level undo for a completed deletion.

## If deletion fails

Do not repeat the action immediately when the result is uncertain. Refresh the
space first. If the file remains and the error continues, report the project,
Storage Space, file path, time, and exact error message.

## Related pages

- [Files](index.md)
- [Previous versions](versions.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/portal-object-list.light.png" alt="Portal file list inside a Storage Space" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/portal-object-list.dark.png" alt="Portal file list inside a Storage Space" loading="lazy">
</div>
