# Feature: Object Operations in Browser

## When to use

Use this guide for object-level actions in Browser surfaces.

## Prerequisites

- Access to `/browser`, `/manager/browser`, or `/ceph-admin/browser`.
- Effective permissions for target bucket/prefix.

## Before you start

Select the execution context before choosing a bucket. The same bucket name may exist in another account or connection, and object actions always use the current context credentials.

## Steps

1. Open a browser surface and choose context/account.
2. Navigate to the target bucket and prefix.
   - On `/browser`, use the left buckets panel to switch bucket directly and inspect folders for the active bucket.
   - Non-active buckets stay collapsed; inaccessible buckets are dimmed until selected.
3. Use actions as needed:
   - Use the context menu for the full action set on the current path, object, or selection.
   - Click anywhere on a row or mobile card, outside its interactive controls,
     to open the primary destination. A folder navigates, a file opens on
     `Preview`, and a deleted object opens `Versions` or Portal `History`.
   - Use the checkbox only for selection. On desktop, selection actions replace
     the right side of the stable context bar so the list does not move. The
     mobile bottom bar exposes the essential actions without horizontal
     scrolling. Use `More` for every secondary action.
   - With Technical S3 tools, use `More > Display > Columns` to choose which object columns are visible. The default column set stays unchanged until you customize it.
   - Drag a column separator in the objects table header to resize `Name` and visible object columns. Double-click a separator to restore that column default width.
   - On `/browser`, use `More > Display > Folders panel` to enable Folders. Object details open
     in one contextual drawer that is independent from row selection.
   - With Technical S3 tools, **Details** on a folder and **Path details** for
     the current context open the same drawer shell with the effective bucket
     and S3 prefix. An on-demand recursive count reports the current objects and,
     when relevant, versions and delete markers without changing the listing.
     Standard and Portal do not expose this technical path view.
   - In a Portal project context, that shared drawer exposes `Preview`,
     `History`, `Sharing`, and `Details`, just as it does inside the Storage
     Space page.
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
- Selection actions include download, ZIP, rename, copy/move to a destination, open, copy URL, copy, cut, bulk attributes, advanced actions, restore, and delete when the current selection allows them.
- File entry points such as `Preview`, `Versions`, and advanced object actions converge into the same details drawer, each opening the most relevant tab first.
- Long-running bulk actions surface in **Operations overview**, where queued, active, completed, and failed work stays visible without leaving Browser.
- `More` remains available in embedded Manager, Ceph Admin, and Portal Browser
  surfaces, where profile and resolved capability facts decide the visible set.
- On the main `/browser` page, `More > Display` lets every user choose
  Comfortable or Compact and controls the Folders panel. Compact keeps
  the path and icon actions on one row;
  Comfortable keeps labeled actions on that row when the window is wide and
  moves them to a second row when space is tighter. These choices are stored
  for the root Browser only. The default is a compact view with Folders hidden,
  suitable
  for small windows and dense object lists.
- With Technical S3 tools, object columns available from `More > Display > Columns` include base listing columns such as `Size`, `Modified`, `Storage class`, and `ETag`, plus lazy detail columns such as `Content-Type`, `Tags`, `Metadata`, `Cache-Control`, `Expires`, and `Restore status`.
- Custom column widths are stored locally in the current browser and stay separate between the main `/browser` page and embedded browser surfaces.
- `Reset columns` restores both the default visible columns and the default widths.
- Only base listing columns are sortable. Lazy detail columns are display-only and load on demand for visible rows.
- Actions can be disabled for the current state. For example, `Copy URL` is disabled when SSE-C is active, and deleted items must be restored from versions before direct download or delete operations.
- Standard includes normal file operations and read-only properties. Advanced
  adds technical S3 tools, editable properties, bulk and cross-context
  operations, multipart supervision, path details, and bucket configuration.
  On the dedicated Browser, **Bucket details** is a read-only summary. Manager
  and Ceph Admin embeds expose **Bucket settings** with the supported editors in
  the same guarded drawer. Portal exposes
  only end-user actions authorized by the Portal-provided capabilities.
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

Check the selected object state, current surface, Browser feature flags, and IAM/S3 permissions. Some actions appear only for a file, only for a folder, or only when versioning is available.

## Limits / feature flags

!!! note
    Browser availability and operation sets depend on workspace browser flags and endpoint capabilities.
    Direct transfers also require bucket CORS rules for the Browser origin. Multipart
    uploads require those rules to expose `ETag`; when BucketReef can read an
    incompatible configuration, it offers the existing CORS repair action and uses
    proxy transfers when they are enabled.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Workspace: Manager](workspace-manager.md)
- [Feature: Object versions in Browser](feature-object-versions-browser.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-objects-browser.light.png" alt="Browser operations overview showing a running delete on selected objects" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-objects-browser.dark.png" alt="Browser operations overview showing a running delete on selected objects" loading="lazy">
</div>

## Selection scope and volume

Select loaded items selects only the rows already loaded in the current listing.
The selection summary separates files, folders, known bytes and uncalculated
volume. Calculate volume enumerates selected folders on demand, removes overlaps
and can be cancelled. Folder contents are never silently counted as zero.

**More > Help and shortcuts** opens the keyboard reference. The main transfer
status distinguishes direct transfers, transfers via the server and unavailable
transfers; expand its secondary information for CORS diagnostics. This technical
status does not grant storage access. Unavailable actions expose their reason
in the action menus, including keyboard and touch access.

## Destination conflicts

Uploads and copies inspect destination keys before starting. Existing objects
require an explicit Replace, Skip or Keep both decision, individually or for
the batch. Keep both checks a numbered name before the extension. Duplicate
keys within one batch must be skipped or assigned distinct names. A denied
inspection never means the object is absent.

Destinations are rechecked when writing. AWS endpoints additionally use signed
conditional writes; other providers use an explicitly non-atomic preflight.
Changes detected after a decision stop the affected operation; retry it after
reviewing the new destination. Conditions are never silently removed after a
provider rejection. Replacement may overwrite data when versioning is disabled.

### Rename, copy and move

The selection menu and item menu provide **Rename**, **Copy to…** and **Move to…** for current files and folders. Choose a destination in the current storage context and review the source → destination summary. In Portal, destinations are the project's accessible Storage Spaces; read-only destinations cannot receive objects. Cross-context clipboard transfers still require the Advanced profile.

Overlapping selections are expanded once, including empty-folder marker objects. A folder cannot be copied or moved inside itself. Conflicts use the same explicit decisions as uploads. Renaming moves the current keys; historical versions remain at the original keys. Objects above the single S3 copy limit use multipart server-side copy. Cross-context reads use the selected version or an ETag condition to avoid silently copying a changed source.

Before deleting a source, Browser checks its identity and verifies the copied result. Changed sources, failed verification and unsupported conditional deletion produce **Copied, not deleted**, retaining the source. A multipart ETag is checked against the copy result, not compared with the source's ETag. Provider support for conditional deletion must be qualified against the deployed RGW version; no unconditional delete fallback is used.

### Search scopes and file filters

Open **Search options** inside the search field to choose **This folder**, **With subfolders**, or **Whole bucket** (**Whole space** in Portal). The same advanced-search panel contains size, modification dates, extensions and matching options. Changes take effect with **Apply**; **Reset** clears the draft. Its badge counts active options. The whole-space scope stays inside the authorized Storage Space and never searches other projects. Scope and filters work without a text query.

File filters combine minimum/maximum bytes, inclusive modification dates and comma-separated extensions. Dates entered in the browser use your local time zone and are sent with their UTC offset. File filters exclude folders and deletion markers and cannot be combined with the Folders-only option. Existing exact matching, case sensitivity and storage-class options remain available.

Filtering takes place on the server before pagination, including sorted listings. **Partial results** means more listing pages remain; explicitly load more to continue. An empty result offers a wider scope without choosing it automatically. Ascending-name requests retain their bounded scan budget. Global sorted scans stop at 200 S3 pages or 20 seconds and ask you to narrow the scope or return to ascending-name pagination. No object-content or tag index is created.

### Personal path favorites

The standalone sidebar has **Buckets / Favorites** tabs. Each favorite shows its bucket, path and context in a subtitle. Search the list or use an item's menu to rename or remove it. Embedded surfaces use a compact star button.

Use **Pin location** to save the current context and exact path. Favorites synchronize through your UI account and refresh when the window regains focus. Concurrent edits or removals are rejected; refresh before retrying. Unavailable locations remain identifiable and never silently change execution identity.

Temporary S3 sessions cannot synchronize favorites. Standalone and embedded workspace collections remain separate. Favorites do not save search, filters, sorting or columns. Previously saved views are removed by the path-favorites migration; existing path favorites retain their IDs and revision history.

### ZIP for a mixed selection

**Download as ZIP** accepts files and folders together. Browser recursively enumerates the selected folders, deduplicates overlapping objects and preserves paths relative to the starting location. Preparation, transfer and packaging appear in Operations and can be cancelled.

Unsafe archive paths (including traversal, absolute/ambiguous paths and case/Unicode or file/folder collisions) are excluded with an explanation in operation details. Objects are never silently overwritten inside the archive. Large selections use streaming to a file when supported. Without streaming, a selection at or above the configured ZIP threshold is blocked before downloading its contents; select fewer files or use a browser with streaming file support. The threshold concerns the total input bytes; archive packaging also needs working memory.

**Retry failures** produces a complementary archive containing only files that failed to download. Successful files are not downloaded again. ZIP generation does not resume after closing the browser.

### Structured previews and navigation

CSV files display an inert table, including quoted and multiline cells. JSON files display a collapsible tree. **Raw text** is always available; invalid, truncated or excessively complex structures automatically fall back to source text. **Find in displayed text** searches only the loaded text and highlights its first 200 matches. Markup and spreadsheet formulas are displayed as text, never executed.

**Previous** and **Next** navigate among the current listing's loaded, non-deleted files without changing the selection or loading additional pages. Pending changes in an editable details drawer still require the existing discard confirmation. Preview limits remain 50 MiB per object and 64 KiB of text (UTF-8 bytes, including Portal-supplied text). There is no new Office renderer or active HTML preview.

### Local transfer history, retry and upload recovery

Open **Transfers and recovery** for the session's operations, their destinations and locally saved multipart uploads. **Retry failures** repeats only unsuccessful files. Copies and moves retain completed copy steps in the current session: a move retries only source deletion after checking the original source and copied destination again. Closing the page loses these copy/move steps; it does not resume server-side copies or ZIP generation.

Uploads of at least 25 MiB use multipart in direct and proxy mode. **Pause** preserves uploaded parts; **Cancel** aborts the remote multipart upload. After returning and signing in, select the original context and destination, then reselect the original file. A worker hashes every block and rejects different file contents. Browser reconciles saved receipts with S3 ListParts and sends only missing or invalid parts. Unrecognized remote parts are safely resent. No upload resumes automatically and no background worker keeps uploading after browser closure.

Recovery metadata lives only in IndexedDB: identity/context references, destination, multipart identifier, file characteristics, block fingerprint and completed part receipts. It contains no file payload, S3 credentials, presigned URL or SSE-C key. Supply the original SSE-C key again in the destination's encryption settings. Access is checked again when reading parts, sending parts and completing the upload. A vanished remote upload is explicitly non-resumable. Browser uses an exclusive Web Lock so only one tab can resume or cancel the same saved upload.

Local recovery requires an authenticated identity, IndexedDB, Web Locks and worker support. UI accounts use their account identity. Temporary S3 sessions use an opaque, server-derived reference to the endpoint and access key: sign in with the original key to find their pending uploads. The reference grants no access and contains no S3 credential. Changing that key or the deployment's primary credential-encryption key makes those old local entries undiscoverable under the new identity.

Where local recovery is unavailable, ordinary uploads remain possible but interrupted uploads restart. Clearing or evicting browser storage loses recovery information; S3 lifecycle rules may also remove incomplete uploads. **Forget local entry** removes local tracking only, while **Cancel remote upload** abandons the S3 multipart upload. Pending entries do not expire automatically.

The local history retains the last 20 completed batches for 30 days, separately from server audit logs. It is scoped to the current identity and Browser surface, and is not synchronized between browsers. Small uploads and downloads restart from the beginning. Large native downloads remain managed by the browser's download manager. Server storage is used only for the previously documented favorites/views collection, never for upload tracking.
