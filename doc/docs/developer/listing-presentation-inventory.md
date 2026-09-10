# Table and listing presentation inventory

The September 2026 convergence preserves columns, content, rights and behavior.
The inventory is based on rendered JSX sites, so files containing both a main
inventory and secondary tables appear once with both counts. It replaces the
preliminary import-based count: **55 components, 68 table render sites**,
including `DataTableShell` itself. The raw-table sites include help tables,
association editors, operation results and dialogs, not just routed inventories.

All entries consume `components/list/listPresentation.css`. Use `ListActionButton`,
`ListActionLink`, `ListActions` and `ListBadge` for actions and badges. Native
summary/menu triggers keep their HTML semantics with the same `ui-list-action`
or `ui-list-menu-item` styles. The role/link callbacks and storage engines remain
owned by their existing feature components.

## Component, route and validation map

Unit coverage is named explicitly; absence of a dedicated component suite is
not proof of its full interaction flow. The full frontend suite additionally
covers shared sort, pagination, selection, row-click isolation, protected forms,
menus, association popovers, expansion and Browser column resizing.

| Component under `frontend/src` | Route / secondary surface | Primitive and sites | Validation |
| --- | --- | --- | --- |
| `components/list/DataTableShell.tsx` | Shared foundation for all consumers below | ui-data-table × 1 | `components/__tests__/DataTableShell.test.tsx` |
| `features/admin/AccountsPage.tsx` | /admin/s3-accounts; linked users/groups in account editor | DataTableShell × 1; ui-data-table × 2 | `AccountsPage.modalTabs.test.tsx`; Authenticated Admin (including empty listing) |
| `features/admin/AdminAssociationPicker.tsx` | /admin/users, /admin/groups, /admin/s3-accounts, /admin/s3-users, /admin/s3-connections; association tables | ui-data-table × 1 | `AdminAssociationPicker.test.tsx` |
| `features/admin/AdminPortalRequestsPage.tsx` | /admin/portal-requests | DataTableShell × 1 | `AdminPortalRequestsPage.test.tsx` |
| `features/admin/ApiTokensPage.tsx` | /admin/api-tokens | DataTableShell × 1 | `ApiTokensPage.listState.test.tsx` |
| `features/admin/AuditLogsPage.tsx` | /admin/audit | DataTableShell × 1 | `AuditLogsPage.test.tsx` |
| `features/admin/BillingPage.tsx` | /admin/billing | DataTableShell × 1 | `BillingPage.test.tsx` |
| `features/admin/EndpointStatusDetailPage.tsx` | /admin/endpoint-status/:endpointId; timeline and recent checks | DataTableShell × 2 | `EndpointStatusDetailPage.test.tsx` |
| `features/admin/EndpointStatusPage.tsx` | /admin/endpoint-status | DataTableShell × 1 | `EndpointStatusPage.test.tsx` |
| `features/admin/GroupsPage.tsx` | /admin/groups | DataTableShell × 1 | `GroupsPage.test.tsx` |
| `features/admin/IdentitySecurityPage.tsx` | /admin/identity-security; identities and link requests | DataTableShell × 2 | `IdentitySecurityPage.test.tsx` |
| `features/admin/KeyRotationPage.tsx` | /admin/key-rotation; endpoint results | DataTableShell × 1 | `KeyRotationPage.test.tsx` |
| `features/admin/S3ConnectionsPage.tsx` | /admin/s3-connections; inventory and linked users/groups | DataTableShell × 1; ui-data-table × 2 | `S3ConnectionsPage.modalTabs.test.tsx`, `S3ConnectionsPage.validation.test.tsx`; Authenticated Admin (including empty listing) |
| `features/admin/S3UserKeysPage.tsx` | /admin/s3-users/:userId/keys | DataTableShell × 1 | Shared primitive tests; no dedicated component suite |
| `features/admin/S3UsersPage.tsx` | /admin/s3-users; inventory and linked users/groups | DataTableShell × 1; ui-data-table × 2 | `S3UsersPage.modalTabs.test.tsx` |
| `features/admin/StorageEndpointList.tsx` | /admin/storage-endpoints | DataTableShell × 1 | `StorageEndpointsPage.tags.test.tsx`; V1; authenticated Admin |
| `features/admin/UsageHistoryPage.tsx` | /admin/usage-history | DataTableShell × 1 | `UsageHistoryPage.test.tsx` |
| `features/admin/UserAccountAssociationsPanel.tsx` | /admin/users, /admin/groups; account associations | ui-data-table × 1 | Shared primitive tests; no dedicated component suite |
| `features/admin/UserAssociationsTabs.tsx` | /admin/users, /admin/groups; RGW user and S3 connection associations | ui-data-table × 2 | Shared primitive tests; no dedicated component suite |
| `features/admin/UsersPage.tsx` | /admin/users; inventory and role-access help table | DataTableShell × 1; ui-data-table × 1 | `UsersPage.modalTabs.test.tsx`; V2; authenticated Admin |
| `features/browser/BrowserMultipartUploadsModal.tsx` | /browser, /manager/browser, /ceph-admin/browser; multipart uploads dialog | DataTableShell × 1 | `BrowserMultipartUploadsModal.test.tsx` |
| `features/browser/BrowserObjectTableScaffold.tsx` | /browser, /manager/browser, /ceph-admin/browser, /portal/storage-spaces/:spaceId; object table | ui-data-table × 1 | `BrowserObjectTableScaffold.test.tsx`; V9; authenticated Browser/Moto |
| `features/cephAdmin/CephAdminAccountEditModal.tsx` | /ceph-admin/accounts; quota/usage table | ui-data-table × 1 | Shared primitive tests; no dedicated component suite |
| `features/cephAdmin/CephAdminAccountsPage.tsx` | /ceph-admin/accounts | DataTableShell × 1 | `CephAdminAccountsPage.test.tsx` |
| `features/cephAdmin/CephAdminBucketIndexCheckPage.tsx` | /ceph-admin/buckets; index-check workflow | ui-data-table × 1 | `CephAdminBucketIndexCheckPage.test.tsx` |
| `features/cephAdmin/CephAdminUserEditModal.tsx` | /ceph-admin/users; keys and usage tables | ui-data-table × 2 | Shared primitive tests; no dedicated component suite |
| `features/cephAdmin/CephAdminUsersPage.tsx` | /ceph-admin/users | DataTableShell × 1 | `CephAdminUsersPage.listState.test.tsx` |
| `features/manager/BucketDetailPage.tsx` | /manager/buckets/:bucketName; objects, lifecycle rules and ACL grants | ui-data-table × 3 | `__tests__/BucketDetailPage.replication.test.tsx` (replication flow); shared table tests |
| `features/manager/BucketsPage.tsx` | /manager/buckets | DataTableShell × 1 | Shared primitive tests; no dedicated component suite; V4 |
| `features/manager/FeatureRulesTable.tsx` | /manager/feature-rules; grouped rules and expanded details | ui-data-table × 1 | `ManagerFeatureRulesPage.test.tsx` |
| `features/manager/ManagerBucketSelectionPanel.tsx` | /manager/bucket-compare, /manager/bucket-integrity, /manager/bucket-purge; bucket picker | DataTableShell × 1 | `ManagerBucketSelectionPanel.test.tsx` |
| `features/manager/ManagerCephKeysPage.tsx` | /manager/ceph/keys | DataTableShell × 1 | `ManagerCephKeysPage.test.tsx` |
| `features/manager/ManagerEntityPoliciesPage.tsx` | /manager/users/:userName/policies, /manager/groups/:groupName/policies, /manager/roles/:roleName/policies | DataTableShell × 1 | `ManagerEntityPoliciesPages.inlinePolicies.test.tsx` |
| `features/manager/ManagerGroupUsersPage.tsx` | /manager/groups/:groupName/users | DataTableShell × 1 | `ManagerGroupUsersPage.test.tsx` |
| `features/manager/ManagerGroupsPage.tsx` | /manager/groups | DataTableShell × 1 | Shared primitive tests; no dedicated component suite |
| `features/manager/ManagerRolesPage.tsx` | /manager/roles | DataTableShell × 1 | Shared primitive tests; no dedicated component suite |
| `features/manager/ManagerUserKeysPage.tsx` | /manager/users/:userName/keys | DataTableShell × 1 | `ManagerUserKeysPage.test.tsx` |
| `features/manager/ManagerUsersPage.tsx` | /manager/users | DataTableShell × 1 | `ManagerUsersPage.test.tsx`; V3 |
| `features/manager/PoliciesPage.tsx` | /manager/iam/policies | DataTableShell × 1 | Shared primitive tests; no dedicated component suite |
| `features/manager/TopicsPage.tsx` | /manager/topics | DataTableShell × 1 | `TopicsPage.test.tsx` |
| `features/portal/PortalAccessKeysPage.tsx` | /portal/access-keys | DataTableShell × 1 | `PortalAccessKeysPage.test.tsx`; V6 |
| `features/portal/PortalActivityPanel.tsx` | /portal, /portal/history, /portal/storage-spaces/:spaceId; activity table | DataTableShell × 1 | `PortalActivityPanel.test.tsx` |
| `features/portal/PortalCollaboratorAccessPage.tsx` | /portal/shares/:userId | DataTableShell × 1 | `PortalCollaboratorAccessPage.test.tsx` |
| `features/portal/PortalHistoryPage.tsx` | /portal/history | DataTableShell × 1 | `PortalHistoryPage.test.tsx` |
| `features/portal/PortalPublicLinksTable.tsx` | /portal/shares, /portal/storage-spaces/:spaceId; public links | DataTableShell × 1 | `PortalPublicLinksTable.test.tsx` |
| `features/portal/PortalRequestsPage.tsx` | /portal/requests | DataTableShell × 1 | `PortalRequestsPage.test.tsx` |
| `features/portal/PortalSharesPage.tsx` | /portal/shares | DataTableShell × 1 | `PortalSharesPage.test.tsx` |
| `features/portal/PortalStorageSpacesPage.tsx` | /portal/storage-spaces | DataTableShell × 1 | `PortalStorageSpacesPage.test.tsx`; V5 |
| `features/shared/BucketIntegrityCheckModal.tsx` | /manager/bucket-integrity and integrity workflows from /ceph-admin/buckets, /storage-ops/buckets; failure samples | ui-data-table × 1 | `BucketIntegrityCheckModal.test.tsx` |
| `features/shared/BucketOpsBulkTransferFields.tsx` | /ceph-admin/buckets, /storage-ops/buckets; transfer selection dialog | ui-data-table × 1 | `BucketOpsBulkTransferFields.test.tsx` |
| `features/shared/BucketOpsTable.tsx` | /ceph-admin/buckets, /storage-ops/buckets; specialized inventory | ui-data-table × 1 | `BucketOpsTable.test.tsx`, `BucketOpsTableCells.test.tsx`; V7/V8 |
| `features/shared/BucketPurgeRunModal.tsx` | /manager/bucket-purge, /manager/buckets and purge workflows from /ceph-admin/buckets, /storage-ops/buckets; failure samples | ui-data-table × 1 | `BucketPurgeRunModal.test.tsx` |
| `features/shared/BucketUsageStatsRunModal.tsx` | Manager, Ceph Admin and Storage Ops usage workflows; result breakdown | ui-data-table × 1 | `BucketUsageStatsRunModal.test.tsx` |
| `features/shared/ProfilePage.tsx` | /{admin,manager,portal,browser,ceph-admin,storage-ops}/profile; private S3 connections | ui-data-table × 1 | `ProfilePage.validation.test.tsx` |
| `features/shared/bucketCompareShared.tsx` | /manager/bucket-compare and compare dialogs in Ceph Admin/Storage Ops; manual mappings | ui-data-table × 1 | `bucketCompareShared.test.ts` |

## Visual coverage

`listingsVisualQa.spec.ts` exercises V1 endpoints, V2 Admin users, V3 Manager
users, V4 Manager buckets, V5 Portal spaces, V6 Portal tool keys, V7 Ceph Admin
buckets, V8 Storage Ops buckets and V9 Browser objects. Every case runs at
1440 × 900 in light/blue and dark/custom purple, at 390 × 900, at a 720 × 450
reflow viewport, and at 1440 × 900 with a coarse pointer. Existing Portal
translations are exercised in English, French and German. Reflow emulates the
CSS viewport of 200% zoom; it is not a claim of native browser-zoom testing.

The assertions cover typography, button weights and target heights, focus
visibility, document overflow, action alignment and mobile card overlap.
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
