# Table and listing presentation inventory

The October 28, 2026 audit covers every rendered non-test table site under
`frontend/src`. The current inventory contains **77 components and 87 table
render sites**: **72 `DataTableShell` sites** and **15 reviewed raw-table sites**.
The static `listings:check` guard owns this count and rejects any new raw table
unless its file and expected site count are explicitly reviewed.

The presentation contract is defined in `doc/docs/developer/en/frontend/product-design.md`:
page inventories use `ListPageSection` around `DataTableShell`; embedded
association/configuration tables stay flat in their owning surface; specialized
operational grids may retain task-specific geometry while consuming the shared
typography, separators, states, density and action controls.

All listing actions and badges use `ListActionButton`, `ListActionLink`,
`ListActions` and `ListBadge`. Native summary/menu triggers keep their HTML
semantics with the same shared list styles. Feature components continue to own
business behavior, permissions and storage operations.

## October 2026 audit result

The full render-site scan found no unreviewed table geometry. Ordinary tables
that previously remained page-specific were normalized during this audit:

- Admin shared S3 connection and RGW user association tables now use the shared
  `AdminAssociationLinkedTable` wrapper.
- Ceph Admin access-key and top-bucket usage tables now use `DataTableShell`.
- Manager bucket ACL grants now use `DataTableShell`.
- The Admin OpenStack cloud inventory now uses the page inventory boundary
  (`ListPageSection` + `DataTableShell`).
- Profile Private S3 connections, OpenStack connections and API tokens already
  use the same page/section inventory structure established by the preceding
  normalization pass.

The remaining raw `<table>` sites are deliberate exceptions. They are kept in
`frontend/scripts/check-listing-presentation.mjs`; changing or adding one
requires a new UX review.

| Raw table site | Sites | Reason for exception |
| --- | ---: | --- |
| `components/list/DataTableShell.tsx` | 1 | Shared primitive implementation. |
| `demo/toolbar.tsx` | 1 | Isolated presentation demo, not an application inventory. |
| `features/admin/AdminAssociationPicker.tsx` | 2 | Shared lightweight association wrappers with caller-owned editable/composed rows. |
| `features/admin/AdminDashboard.tsx` | 1 | Small metric-coverage matrix embedded in dashboard help content. |
| `features/browser/BrowserObjectTableScaffold.tsx` | 1 | Operational object grid with fixed/sticky headers, selection and column resizing. |
| `features/cephAdmin/CephAdminBucketIndexCheckPage.tsx` | 1 | Diagnostic result grid with fixed task-specific geometry. |
| `features/manager/BucketDetailPage.tsx` | 1 | Embedded object preview inside the bucket detail split workflow. |
| `features/manager/FeatureRulesTable.tsx` | 1 | Grouped rules with expansion and specialized row geometry. |
| `features/shared/BucketOperationResult.tsx` | 1 | Bounded, keyboard-scrollable failure detail table inside operation results. |
| `features/shared/BucketOpsBulkTransferFields.tsx` | 1 | Editable source/destination mapping inside a bulk-transfer workflow. |
| `features/shared/BucketOpsTable.tsx` | 1 | Operational bucket workbench with selection, pinned columns and advanced filtering. |
| `features/shared/BucketUsageStatsRunModal.tsx` | 1 | Bounded operation-result breakdown in a run workflow. |
| `features/shared/ObjectTextPreview.tsx` | 1 | CSV content preview whose columns are data-driven. |
| `features/shared/bucketCompareShared.tsx` | 1 | Editable source/target mapping with raw-mapping overrides. |

These exceptions still use `ui-data-table`; they do not authorize local row
height, typography, badge or action geometry. The shared checker also rejects
legacy table classes and locally styled list actions.

## Standard table families

The remaining 72 sites use `DataTableShell` and fall into the approved families:

| Family | Representative surfaces | Required structure |
| --- | --- | --- |
| Page inventory | Admin accounts/users/groups/endpoints/audit/cost/status, Manager users/groups/roles/buckets/topics, Portal storage/access/history, Ceph Admin accounts/users/multisite, shared Profile/OpenStack | `PageHeader` owns the page title and main create action; `ListPageSection` owns list controls and the table; pagination is used when the dataset is pageable. |
| Embedded association/configuration | Admin account/user/group associations, Ceph account/user drawer details, Manager bucket ACL/CORS/lifecycle/notification/policy/replication sections | Flat table in the owning editor/tab/section with only useful local state and actions; no repeated card/title/toolbar. |
| Embedded workflow/detail | Endpoint detail, key rotation results, Browser multipart/version dialogs, Manager migration detail/wizard, Portal public links, selection panels | `DataTableShell` without a page inventory wrapper when the table is subordinate to the workflow or detail surface. |

Numeric columns are right-aligned, identity is the first meaningful column,
actions are right-aligned, headers use the shared muted treatment, and ordinary
rows use the shared density. One functional block should have one visual
boundary; nested decorative table cards are not part of the standard pattern.

## Header variant inventory (outside Browser)

All control-bearing lists below use the same search/filter/tools/count row.
`page` means no extra visible title; `section` means a heading above that row.
This classification supplements the table-site inventory above, including
secondary and dialog uses.

| Uses | Header convention |
| --- | --- |
| Admin accounts, users, groups, RGW users, shared connections, endpoints, RGW user keys, audit, usage history and Portal request queue | `page`; main creation in the page header |
| Admin identity-link requests and sessions | `page`; tab counts and security guidance remain visible |
| Cost subjects, Endpoint Status incidents, key-rotation execution results | `section`; page context continues to affect its original sections |
| Admin association lists and add-association pickers | `section`; Add in `headingActions`, search in the common row; editable row fields and dialog confirmation remain unchanged |
| Manager users, groups, roles, policies, buckets, topics, user/RGW keys, feature rules and migration runs | `page`; table/tab identifies the list |
| Manager group members and attached managed policies | `section`; distinct from membership/attachment forms and inline policy blocks |
| Manager bucket selection for compare, integrity, purge and migration | `section`; execution action in `headingActions`, selection tools in the control row |
| Portal Storage Spaces, activity, access logs, collaborators, help requests and tool-access tab | `page`; existing Portal translations and key/logging explanations retained |
| Portal collaborator detail: effective Storage Space access | `section`; inherited access guidance retained |
| Ceph Admin accounts/users and Ceph Admin/Storage Ops bucket workbench | `page`; multiline exact search, advanced filters, column controls and selection remain supported |
| API tokens in the shared profile | `section`; creation in the section heading |
| Shared private S3 connections profile | `page` outside Browser; creation is rendered into the owning page header; Browser keeps its original markup |
| Endpoint detail timeline/recent checks, Ceph usage/quota/key detail tables, Manager bucket ACL/lifecycle tables, public links, operation samples/breakdowns and comparison mappings | Informational tables retain their existing enclosing section/form; no artificial controls added |
| Browser object tables, multipart dialog, embedded explorers and their object/detail panels | Excluded from the header convergence, including shared public-link components used inside them |

Desktop Storage Space sort now uses the Name/Files/Size/Created column headers.
Existing column sorts share their transitions with mobile controls, without
changing initial sorting or pagination. Bucket workbench headers remain visible
in their scrollable table on mobile, so no second sort control is added there.
Audit Action/Status are explicitly limited to loaded entries. Server search,
advanced filter semantics, endpoint context and Cost global totals retain
their existing scope. Cost CSV exports the whole selected month/endpoint,
so it stays beside that page context. Endpoint Status refreshes all metrics and
incidents; Manager member/policy refresh reloads both form choices and listed
bindings. These page-wide refresh actions stay in the page header. API-token
and Identity Security refresh tools live in their list bars.

## Visual coverage

`listingsVisualQa.spec.ts` exercises V1 endpoints, V2 Admin users, V3 Manager
users, V4 Manager buckets, V5 Portal spaces, V6 Portal tool keys, V7 Ceph Admin
buckets, V8 Storage Ops buckets, V9 Browser objects and the Manager bucket
selection section. Every case runs at
1440 × 900 in light/blue and dark/custom purple, at 390 × 900, at a 720 × 450
reflow viewport, and at 1440 × 900 with a coarse pointer. Existing Portal
translations are exercised in English, French and German. Reflow emulates the
CSS viewport of 200% zoom; it is not a claim of native browser-zoom testing.

The assertions cover typography, button weights and target heights, focus
visibility, document overflow, action alignment and mobile card overlap.
The shared header assertions also check both variants, accessible search names,
search-icon spacing, normal-case filter labels, control order and one-line
ordinary desktop bars. `consultationVisualQa.spec.ts` covers the seven compact
consultation pages plus the Portal access-log tab and its advanced drawer.
Component tests cover keyboard order, section action
placement, column/mobile sort synchronization, filtering and profile opt-in.
Screenshots are reviewed in addition to these geometric checks. The nine
user-documentation pairs are generated separately in English with the usual
light/dark theme. Temporary QA screenshots and measurements are not committed.

The isolated `ui:agent:check` uses real Admin and Browser authentication and Moto.
It covers reloads, endpoint editor round trips, compact settings and profile
navigation protections. Portal, Manager and RGW visual fixtures do **not** prove
real Ceph connectivity or authorization. No live Ceph validation was performed
for this presentation-only change; full assistive-technology certification is
also outside this evidence.

## Allowed geometry and scope exceptions

- Embedded tables retain intrinsic column widths. `DataTableShell`, Browser,
  feature rules and index checks explicitly use `ui-data-table-fixed`; their
  existing automatic-layout overrides remain available. Fixed columns must
  reserve enough width for their action group instead of forcing a line break.
- Browser keeps 36px Compact and 64px Comfortable rows, column resizing,
  fixed headers and its mobile list. Comfortable row actions retain 44px
  targets. Coarse-pointer controls can make Compact rows taller as needed.
- Endpoint rows keep their enriched identity, tags and enabled-service summaries;
  they expand with content instead of hiding information.
- Bucket operation and feature-rule tables retain grouped rows, expansion,
  specialized column widths and internal scrolling. Operation dialogs keep
  their bounded scroll regions. Responsive cards use automatic height.
- Native identity links, avatar stacks, selection controls, progress tracks,
  status dots and column-resize handles are not action buttons or text badges.
- `UiButton`, settings controls and non-list form actions retain their defaults.
  `formInlineActionClasses` holds the former inline form styles still needed by
  association option editors; listing renderers must not import them.

Run `npm run listings:check` to reject legacy table classes, missing raw-table
adoption, local action/badge geometry and local styled row buttons. This guard
is included in `check` and `check:ci`; it complements rendered tests rather than
claiming that static checks prove accessibility or behavior.
