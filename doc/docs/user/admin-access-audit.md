# Admin: Effective Access Audit

Use **Admin > Audit & Reporting > Access audit** to review the BucketReef
permissions that are currently granted to UI users after direct assignments and
UI Group inheritance are combined.

## What the audit shows

Each row represents one UI user and one permission target. The supported scopes
are **Platform**, **RGW Account**, **RGW User**, and **S3 Connection**. The
**Effective rights** column lists the resulting BucketReef rights, while
**Granted via** identifies whether each right comes from a direct assignment,
one or more UI Groups, or both.

Inactive UI users remain visible so their saved authorization state can still
be reviewed. Private S3 connections are excluded from the Admin inventory;
only Admin-managed shared S3 connections appear.

This page audits BucketReef UI authorization. It does not evaluate storage-side
IAM policies, bucket policies, S3 ACLs, object permissions, or other permissions
enforced by the S3 provider.

## Filtering and export

Search across users, targets, rights, and UI Group names. Use **Scope**,
**Right**, and **Source** to narrow the inventory. Selecting a right keeps the
complete effective-right summary for each matching row so its other effective
rights and grant sources remain visible in context.

Use **Export CSV** to download the complete filtered inventory. Pagination does
not limit the export.

## Reviewing one resource

The edit pages for **UI Users**, **RGW Accounts**, **RGW Users**, and **Shared S3
Connections** include a read-only **Effective access** tab. It shows the saved
effective permissions for the current user or resource and links back to the
global Access audit with the corresponding context filters applied.

The tab reflects persisted state. Save pending association or permission
changes before using it to verify the resulting access.

## Related pages

- [Workspace: Admin](workspace-admin.md)
- [Admin: Audit](admin-audit.md)
- [Workspace: Manager](workspace-manager.md)
