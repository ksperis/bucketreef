# Portal Delegation and Approval Controls

Use this page when an administrator decides which Portal project-membership and
collaboration changes a `portal_manager` may apply directly.

Portal delegation is separate from Manager workspace access. A
`portal_manager` remains a Portal role even when additional project actions are
delegated.

Project settings also share the single Account override managed by Admin.
Delegating its editing allows Portal Managers to choose **Platform value**,
**Enabled** or **Disabled** for applicable options. A **Disabled** platform policy
always wins; neither direct editing nor approval of a request can enable that
feature while the prohibition is active. Existing overrides are retained so a
temporary platform prohibition does not erase the project's choices.

## Delegation controls

From the account's Portal settings, configure the independent delegation
permissions for project-member changes. Both should remain disabled unless the
project owners are intended to perform those changes themselves.

- **Collaborator addition** allows a Portal Manager to add an eligible direct
  project member without waiting for Admin approval.
- **Collaborator role management** allows a Portal Manager to promote or demote
  eligible direct project members between the Portal project roles exposed by
  the UI. Adding a Portal Manager directly also requires the role-management
  permission.

When the required delegation is absent, Portal keeps the user workflow but
creates a pending Help request for administrator approval.

## Boundaries

- Delegation applies only to the supported direct project-membership actions.
- Group-backed memberships remain administrator-managed.
- A Portal Manager cannot change their own project role through the delegated
  workflow.
- Project-member removal remains administrator-controlled when the UI presents
  it as a Help request rather than a delegated direct action.
- Storage Space Viewer/Editor grants remain distinct from project membership.
- Manager `account_administrator` access is configured independently.

## Administrator workflow

1. Open the S3 account's Portal settings in Admin.
2. Review the project roles and group/direct membership model already in use.
3. Enable only the delegation permissions the project owners should exercise.
4. Review pending Portal Help requests for changes that remain Admin-owned.
5. Use application audit and effective-access views to verify the resulting
   control-plane state.

## Related pages

- [Effective access audit](access-audit.md)
- [Audit](audit.md)
- [Portal guide](/portal/en/)
