# Workspace: Admin

## When to use

Use **Admin** for platform governance and global configuration.

## Prerequisites

- `ui_admin` or `ui_superadmin` role.

## Steps

1. Open `/admin`.
2. Use **Platform** to manage UI users.
3. Use **Managed Tenants** to manage RGW accounts and users.
4. Use **Connections** for S3 connections.
5. Use **Storage Backends** for endpoints and endpoint status.
6. Use **Usage & Metrics** to review endpoint-scoped storage, usage composition, usage history, and traffic from tabbed categories.
7. Use **Audit & Reporting** for billing, stored usage-history snapshots, and
   the control-plane/security audit trail. Object operations are investigated
   in S3 provider access logs, not Admin Audit.
8. If superadmin, use **Settings** pages for global behavior, authentication options, UI-managed OIDC/LDAP providers, and key rotation.

The RGW Accounts page uses `/admin/s3-accounts`. The former frontend alias
`/admin/accounts` is no longer supported; update bookmarks to the canonical
URL. Backend account endpoints under `/api/admin/accounts` are unchanged.

## Expected result

Platform and tenant-entry resources are configured and auditable.

## Compact identity associations

The **Managed Tenants** RGW Accounts and RGW Users lists, together with
**Shared S3 Connections**, display linked UI users and UI groups as one compact
avatar stack. User avatars are circular; group pictograms use a rounded-square
shape so the two principal types remain distinguishable. Hover the stack, or
focus one of its links with the keyboard, to open a readable panel containing
each user email, group name, and role as compact badges. To keep very large
tooltips readable, the list is limited to 20 entries and reports how many
additional principals remain.
Click a user or group pictogram to open that principal directly in its edit
page. Emails remain searchable even though they are no longer printed in each
row.

The **UI Users** and **UI Groups** lists summarize storage associations with
three count badges: RGW accounts, RGW users, and shared S3 connections. Their
hover/focus panel exposes the complete bounded list and its roles. **UI Groups**
also shows up to five member avatars before a `+N` indicator; the same panel
still exposes up to 20 members.

In the UI user and UI group editors, association tabs first list the currently
linked resources. Use **Add…** to open a searchable picker, confirm the pending
selection with **Add selected**, and use **Remove** on an existing row to
unlink it before saving. Each RGW account association has two independent
access controls, also available when linking users or groups from RGW Accounts:

- **Manager**: **No Manager access** or **Account administrator**.
- **Portal**: **No Portal access**, **Portal user**, or **Portal manager**.

Choose at least one role before saving. Both can be granted on the same link:
for example, **Account administrator** together with **Portal user** grants
Manager administration and ordinary Portal membership, not Portal management.
Use **Remove** to unlink the account instead of saving two absent roles.
Direct and group grants combine independently for each workspace; removing a
direct grant does not revoke an equivalent right inherited from a UI group.

New links initially select **Portal user** with no Manager access when Portal
is enabled, or **Account administrator** with no Portal access when it is off.
Review this choice before adding the link. Disabling Portal makes its controls
unavailable or read-only, but preserves stored Portal roles; it never converts
them into Manager roles.

Manager's embedded Browser additionally requires **Allow Manager Browser data
access** on the same account association as **Account administrator**. That
advanced opt-in does not grant standalone Browser or Portal access.

Shared S3 Connections are Admin-managed, shared, and Manager-only. Their normal
forms do not expose sharing, Manager, or Browser flags. A connection migrated
without Manager access is shown as **Remediation required** and must be enabled
with the explicit remediation action. Admin routes return `404` for private
connection IDs; private connections remain owned and managed only from the
owner's profile.

The **Portal requests** requester badge uses the same avatar and role panel and
opens the requester's UI user edit page when that user still exists.

The **Created by** column of Shared S3 Connections uses the creator's user
avatar and exposes the creator identity on hover.

UI group pictograms are managed from **Platform > UI Groups > General**. A
group can use initials, one of the predefined pictograms, or a custom PNG/JPEG
image up to 1 MiB. Group images never use Gravatar or an OIDC profile image.

## Limits / feature flags

!!! note
    Billing, Endpoint Status, Portal, and some browser settings are visible only when corresponding features are enabled.

!!! note
    UI User role and entitlement rules:

    - `ui_none`: no workspace access (profile remains accessible).
    - `ui_user`: non-admin workspaces only.
    - `ui_admin`: user-level workspace access plus `/admin`.
    - `ui_superadmin`: admin access plus `/admin/*-settings`.
    - `ui_superadmin` role assignment/promotion is restricted to superadmin users.
    - `can_access_ceph_admin` can be granted only by superadmin users, and only for `ui_admin` or `ui_superadmin`.
    - `can_access_storage_ops` can be granted by `ui_admin` or `ui_superadmin` for `ui_user`, `ui_admin`, or `ui_superadmin`.
    - Manager access can be configured by `ui_admin` or `ui_superadmin` from the **Manager** tab. Each tool also requires its matching global Manager setting to be enabled.
    - Manual private S3 connection creation is configured from the **Connections** tab. Managed IAM/RGW provisioning is configured from the **Manager** tab. Both rights are direct or inherited from UI groups.
    - Entitlements are automatically disabled when the target role does not support them.

!!! note
    Admin **Settings > Authentication** manages access-key login options and UI-defined OIDC/LDAP providers. OIDC and LDAP providers defined by backend environment variables are visible there but remain locked/read-only.

## Related pages

- [Feature: Endpoint Status in Admin](feature-endpoint-status-admin.md)
- [Feature: Billing in Admin](feature-billing-admin.md)
- [Feature: Admin Usage and Metrics](feature-admin-metrics.md)
- [Feature: Usage History in Admin](feature-usage-history-admin.md)
- [Feature: Key Rotation in Admin](feature-key-rotation-admin.md)
- [Admin: Audit](admin-audit.md)
- [Storage admin runbook](admin-runbook-storage-admin.md)
- [Workspace: Manager](workspace-manager.md)
- [Ops / Configuration](../ops/configuration.md)
- [Ops / Security](../ops/operations-security.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-admin.light.png" alt="Admin workspace with platform-level navigation" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-admin.dark.png" alt="Admin workspace with platform-level navigation" loading="lazy">
</div>

## Editing platform settings

General, Authentication, Browser, Manager and Portal settings use compact
sections with one **Save changes / Cancel** area that appears after an edit.
**Reset to defaults** loads defaults for the current page into its draft;
review them and save to apply them. Other settings pages are preserved.
Concurrent edits to the same field are reported instead of overwritten.

General contains workspace availability, services, quota alerts and branding.
**Configure SMTP** opens an internal draft with an explicit test-email action;
testing does not save that draft. **Apply** copies dialog values to the page.
The branding preview is local until a successful save updates the interface.
Manager migration limits and Portal CORS origins use the same dialog pattern.

Authentication lists external providers separately from the global login and
security policy. **Add**, **Edit** and **View** open dedicated OIDC/LDAP pages,
with a return to Authentication. Provider saves are independent of policy
saves. Environment-managed values stay locked. Existing secrets are not shown;
leave them blank to keep the stored secret, following the field's explicit
removal controls. Sensitive updates retain passkey verification.

These administration pages remain in English. The user Portal project settings
and shared profile support English, French and German.
