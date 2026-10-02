# Feature: Object Operations in Browser

## When to use

Use this guide for object-level actions in the standalone Browser workspace.

## Prerequisites

- Access to `/browser` and an eligible Browser storage context.
- Effective permissions for target bucket/prefix.

## Before you start

Select the execution context before choosing a bucket. The same bucket name may exist in another account or connection, and object actions always use the current context credentials.

## Steps

1. Open `/browser` and choose the storage context.
2. Navigate to the target bucket and prefix.
   - On `/browser`, use the left buckets panel to switch bucket directly and inspect folders for the active bucket.
   - Non-active buckets stay collapsed; inaccessible buckets are dimmed until selected.
3. Use actions as needed:
   - Use the context menu for the full action set on the current path, object, or selection.
   - Click anywhere on a row or mobile card, outside its interactive controls,
     to open the primary destination. A folder navigates, a file opens on
     `Preview`, and a deleted object opens `Versions`.
   - Use the checkbox only for selection. On desktop, selection actions replace
     the right side of the stable context bar so the list does not move. The
     mobile bottom bar exposes the essential actions without horizontal
     scrolling. Use `More` for every secondary action.
   - With Technical S3 tools, use `More > Columns` to choose which object columns are visible. The default column set stays unchanged until you customize it.
   - Drag a column separator in the objects table header to resize `Name` and visible object columns. Double-click a separator to restore that column default width.
   - On `/browser`, use `More > Folders panel` to enable Folders. Object details open
     in one contextual drawer that is independent from row selection.
   - With Technical S3 tools, **Details** on a folder and **Path details** for
     the current context open the same drawer shell with the effective bucket
     and S3 prefix. An on-demand recursive count reports the current objects and,
     when relevant, versions and delete markers without changing the listing.
     The Standard profile does not expose this technical path view.
   - Upload files
   - Download objects
   - Preview supported files
   - Delete objects or delete markers
   - Manage versions, restores, metadata, tags, ACL, retention, signed URLs, and archive restore workflows from the unified details drawer for files
4. Use bulk actions when handling many objects.
5. You can copy or cut items and paste into the target bucket or prefix.
   - Same-context paste keeps the existing storage-side copy path.
   - Cross-context paste is available only in the Advanced profile. It is
     frontend-driven and transfers items one by one.
   - Cross-context move deletes the source only after the destination copy is verified.

## Action access

- Path actions include upload, folder creation, paste, versions, restore,
  cleanup, copy path, and Advanced path details.
- The desktop selection bar exposes primary selection shortcuts only while a
  selection exists. Mobile uses a safe-area bottom bar and bottom sheet.
- Selection actions include download, ZIP, open, copy URL, copy, cut, bulk attributes, advanced actions, restore, and delete when the current selection allows them.
- File entry points such as `Preview`, `Versions`, and advanced object actions converge into the same details drawer, each opening the most relevant tab first.
- Long-running bulk actions surface in **Operations overview**, where queued, active, completed, and failed work stays visible without leaving Browser.
- On the main `/browser` page, `More` lets every user choose
  Comfortable or Compact and controls the Folders panel. Compact keeps
  the path and icon actions on one row;
  Comfortable keeps labeled actions on that row when the window is wide and
  moves them to a second row when space is tighter. These choices are stored
  for the root Browser only. The default is a compact view with Folders hidden,
  suitable
  for small windows and dense object lists.
- With Technical S3 tools, object columns available from `More > Columns` include base listing columns such as `Size`, `Modified`, `Storage class`, and `ETag`, plus lazy detail columns such as `Content-Type`, `Tags`, `Metadata`, `Cache-Control`, `Expires`, and `Restore status`.
- Custom column widths are stored locally in the current browser.
- `Reset columns` restores both the default visible columns and the default widths.
- Only base listing columns are sortable. Lazy detail columns are display-only and load on demand for visible rows.
- Actions can be disabled for the current state. For example, `Copy URL` is disabled when SSE-C is active, and deleted items must be restored from versions before direct download or delete operations.
- Standard includes normal file operations and read-only properties. Advanced
  adds technical S3 tools, editable properties, bulk and cross-context
  operations, multipart supervision, and path details. **Bucket details** in
  standalone Browser remains a read-only summary.
- A row click always opens its primary destination. Selection is explicit via
  the checkbox, including Shift-click for a range, so clicking another column
  no longer changes selection unexpectedly.

## Expected result

Object-level operations are executed with current context credentials and reflected immediately.

Names are exact: `"report.txt"` and `" report.txt "` identify different objects.
Metadata/tag columns and object history keep these distinctions, including
names composed only of spaces. Opening an object's history does not substitute
the history of a trimmed name or a neighboring prefix.

Object tag keys and values are also literal. Leading or trailing spaces are
preserved, including a key made only of spaces. An empty tag key or a duplicate
tag key is rejected instead of being silently removed or merged.

Folder navigation also preserves spaces and leading or repeated `/` characters.
For example, `docs/`, `/docs/`, and `docs//` are distinct prefixes. The URL,
editable path, suggestions, recent paths, parent navigation, and path details
keep these distinctions. An empty path (or the **root** button) selects the
bucket root; entering `/` selects the literal `/` prefix. A missing final `/`
is added when entering a folder path. Recursive searches and sorted listings
keep empty path segments as distinct folders as well. Existing objects are
never renamed.

An error does not mean that every requested change was rolled back. After a
failed deletion, copy, move, or upload, refresh the list before retrying. For
writes handled by the backend, affected object listings and metadata/tag columns
are expired from its cache even when the write reports an error.

## You are done when

The object list, details drawer, or Operations overview shows the expected completed state for the selected object or prefix.

## If you do not see this action

Check the selected object state, Browser profile, feature settings, and IAM/S3 permissions. Some actions appear only for a file, only for a folder, or only when versioning is available.

## Limits / feature flags

!!! note
    Browser availability and operation sets depend on Browser settings, the selected context, and endpoint capabilities.
    Direct transfers also require bucket CORS rules for the Browser origin. Multipart
    uploads require those rules to expose `ETag`; when BucketReef can read an
    incompatible configuration, it offers the existing CORS repair action and uses
    proxy transfers when they are enabled.

## Related pages

- [Workspace: Browser](../index.md)
- [Feature: Object versions in Browser](versions.md)
- [Troubleshooting](../help/troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-objects-browser.light.png" alt="Browser operations overview showing a running delete on selected objects" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-objects-browser.dark.png" alt="Browser operations overview showing a running delete on selected objects" loading="lazy">
</div>

## Selection scope

The selection count covers loaded items only. Selecting all does not select unloaded results. Folder contents are enumerated only when an operation, such as ZIP, needs them; no selection-volume calculation runs in the background.

## Uploads and clipboard writes

Uploads and pasted objects use the provider's normal S3 write behavior. An existing key is replaced, or a new current version is created when versioning is enabled. There is no name-conflict prompt or automatic numbered destination.

Use **Copy** or **Cut**, navigate to the destination, and choose **Paste**. Cross-context transfers require the Advanced profile. A move removes the source only after the copy passes the existing verification; failed transfers remain visible in Operations. Folder and object names retain their exact S3 spelling.

### Search options

The Advanced profile exposes the original search-options menu: current path or whole bucket, recursive matching, exact match, case sensitivity, object type and storage class. Whole-bucket and recursive search require a text query; changing scope clears incompatible recursion. Size, date and extension filters are no longer supported.

Listing and sorted pagination keep their existing bounds. A sorted scan can reach its scan limit; narrow the search or use ascending-name pagination to continue.

### Personal path favorites

The standalone sidebar has **Buckets / Favorites** tabs. Each favorite shows its storage location, path and context in a subtitle. Storage Space contexts use the Storage Space name instead of the technical bucket name. Search the list and select a favorite to open it.

Use the star in the current-path bar to add or remove the exact location. An outlined star means the path is not saved; a filled yellow star means it is a favorite. The same yellow star appears beside saved locations in the Favorites sidebar and removes that location directly. New favorites are named automatically from the current folder, or from the bucket/Storage Space at its root. Favorites synchronize through your UI account and refresh when the window regains focus. Duplicate records for the same exact location are treated as one favorite and removed together. Unavailable locations remain identifiable and never silently change execution identity.

Temporary S3 sessions cannot synchronize favorites. Favorites do not save search, filters, sorting or columns. Previously saved views are removed by the path-favorites migration; existing path favorites retain their IDs and revision history.

### ZIP for a mixed selection

**Download as ZIP** accepts files and folders together. Browser recursively enumerates the selected folders, deduplicates overlapping objects and preserves paths relative to the starting location. Preparation, transfer and packaging appear in Operations and can be cancelled.

Unsafe archive paths (including traversal, absolute/ambiguous paths and case/Unicode or file/folder collisions) are excluded with an explanation in operation details. Objects are never silently overwritten inside the archive. Large selections use streaming to a file when supported. Without streaming, a selection at or above the configured ZIP threshold is blocked before downloading its contents; select fewer files or use a browser with streaming file support. The threshold concerns the total input bytes; archive packaging also needs working memory.

ZIP failures and exclusions remain visible in the operation details. ZIP generation does not resume after closing the browser.

### Structured previews and navigation

CSV files display an inert table, including quoted and multiline cells. JSON files display a collapsible tree. **Raw text** is always available; invalid, truncated or excessively complex structures automatically fall back to source text. **Find in displayed text** searches only the loaded text and highlights its first 200 matches. Markup and spreadsheet formulas are displayed as text, never executed.

**Previous** and **Next** navigate among the current listing's loaded, non-deleted files without changing the selection or loading additional pages. Pending changes in an editable details drawer still require the existing discard confirmation. Preview limits remain 50 MiB per object and 64 KiB of text in UTF-8 bytes. There is no Office renderer or active HTML preview.

### Transfer progress

Transfers show their progress and results during the current session. Stop cancels an active operation. Failed transfers can be started again through the normal upload, download or clipboard actions; no failed-item replay or persistent history is kept.

Closing or reloading the Browser interrupts transfers. Multipart uploads are not resumable after returning. Retired local recovery records are cleared without aborting remote uploads; authorized operators can inspect and abort orphaned multiparts through the existing multipart tools.
