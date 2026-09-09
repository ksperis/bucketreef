# Settings UI follow-up

Status: **planned, separate delivery**. The compact personal profile provides the
shared presentation and [product contract](product-design-guidelines.md#compact-settings-with-section-titles-at-the-side).
Other settings pages retain their current layout. Shared line tabs now use an
underline, sidebar Profile selection matches other links, and existing switches
follow the configured theme color with accessible focus and touch targets.
The profile's three binary preferences now use the same switch component.
Shared status badges, property summaries and user-defined tags now follow the
compact 4px-corner, thin-border pattern described in the product guidelines.
Reuse these components when migrating the candidate pages.

## Candidate pages

- [ ] Audit the Admin Browser settings page.
- [ ] Audit the Admin Manager settings page.
- [ ] Audit the Admin Portal settings page.
- [ ] Audit the user Portal settings page.

For each candidate, inventory its current `SettingsLayout`/`PortalSettingsLayout`
usage, permissions, server/local persistence boundaries, translations and dirty
state. Propose compact sections and decide which details should open on demand.
Preserve each workspace's vocabulary and access semantics.

## Migration pass

- [ ] Agree the audited scope and visual examples before migrating pages.
- [ ] Adopt the compact presentation explicitly; do not change shared defaults.
- [ ] Migrate remaining on/off settings from checkboxes to `SettingsSwitch`.
  Keep list selections and acknowledgements as checkboxes, and preserve each
  form's draft/save behavior. Include the two Portal override controls in this
  inventory; do not broaden permissions or change persistence while restyling.
- [ ] Keep shared Save/Cancel behavior only where fields form one coherent
  transaction, with inline error handling and draft protection.
- [ ] Translate new labels and accessible names without mixing languages inside
  the migrated workflow.
- [ ] Validate desktop density, German wrapping, keyboard focus, touch targets,
  light/dark modes and authenticated permissions for every migrated page.
- [ ] Record screenshots and update the guidelines if a new reusable pattern is
  needed. Keep temporary captures and authentication artifacts out of Git.
