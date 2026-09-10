# UI Theme Guidelines

The frontend theme is anchored by the shared shell and UI tokens in
`frontend/src/index.css`, plus reusable class exports in
`frontend/src/components/ui/styles.ts`.

## Tokens

- The default brand color is Reef Blue `#0569f8`. Runtime branding derives the
  complete light and dark primary scales from the configured Admin color.
- Reef Coral `#fc572c` is a decorative brand accent reserved for
  authentication backgrounds. It is not a warning, error, or destructive
  action color; keep success, warning, and danger on their semantic tokens.
- Use primary shade `700` for foreground links and accents in light mode and
  shade `200` in dark mode. Primary buttons may use the base or strong primary
  token with white text.
- Use `shell-*` tokens only for the app shell, topbar, sidebar, and their
  controls.
- Use `ui-*` tokens for workspace content, cards, panels, forms, tables,
  dialogs, toolbars, and inline states.
- Prefer `--ui-surface`, `--ui-surface-muted`, `--ui-border`,
  `--ui-border-soft`, `--ui-text`, `--ui-text-muted`, `--ui-hover`,
  `--ui-selected-bg`, `--ui-focus-ring`, and `--ui-shadow-soft` over local
  Tailwind color chains.

## Primitives

- Cards and panels: start with `ui-surface-card`, `ui-surface-muted`,
  `uiCardClass`, `uiCardMutedClass`, `uiPanelClass`, or
  `uiPanelMutedClass`.
- Tables: use `ui-data-table`, `uiDataTableClass`, and
  `uiTableContainerClass` before adding page-specific table classes.
  `components/list/listPresentation.css` owns the shared `--list-*` tokens;
  the former `manager-table` and `compact-table` style layers are retired.
- Toolbars and filters: use `ListToolbar`,
  `uiToolbarClass`, `uiToolbarSecondaryClass`, shared compact toolbar classes,
  and `ActiveFiltersBar`.
- Compact operational summaries: use `InlineSummary` for label/value pairs.
- Buttons: use `UiButton`, `uiButtonBaseClass`, `uiButtonVariants`, or
  `uiIconButtonClass`; keep custom button chains for exceptional states only.
  In listings, use `ListActionButton`/`ListActionLink` and `ListActions` instead.
  They own geometry, focus, disabled/loading states and semantic variants
  without changing the default form-button scale.
- Forms: use `ui-control`, `uiInputClass`, `uiLabelClass`, and
  `uiCheckboxClass`. Use `SettingsSwitch` for binary settings, reserving
  checkboxes for selections and acknowledgements. Switches use theme primary
  for on and `--ui-text-muted` for the neutral off track; green remains a
  semantic success color, not a fixed switch color.
- Selection: line tabs use a 3px primary underline and primary `700` text in
  light mode / `200` in dark mode. Sidebar links, including Profile, reuse the
  shared active styling and vertical primary marker. Keep shell backgrounds
  on `shell-*` tokens and content backgrounds on `ui-*` tokens.
- Use primary `500` in light mode and `400` in dark mode for active tab/sidebar
  markers and switch tracks. The lighter dark-mode shade keeps these small
  indicators legible, including with darker custom branding colors.
- Keyboard focus on line tabs and switches uses an opaque primary `700` / `200`
  outline so it remains visible on both themes and with custom branding.
- Modals and menus: use `Modal`, `uiMenuClass`, `uiMenuItemClass`, shell menu
  classes in the topbar, and `AnchoredPortalMenu` for positioned menus.
- Badges and tags: use `UiBadge` / `UiTagBadge` and their shared
  `uiBadgeShapeClass` (4px radius, 1px border), pale tone fill and medium text,
  without shadows. Preserve semantic tones and custom tag palettes in both
  themes; contextual markers use `primary`. Keep list-specific compact sizes.

## Patterns To Avoid

- Do not add workspace-scoped themes when a shared token or primitive fits.
- Avoid `bg-gradient-*`, `backdrop-blur`, `shadow-xl`, `shadow-2xl`,
  `rounded-xl`, and `rounded-2xl` on standard workspace surfaces.
- Keep strong shadows, translucent overlays, and larger radii for justified
  cases: authentication screens, popovers, overlays, alerts, and
  temporary operation states.
- Do not use visual refactors to change backend contracts, permissions, IAM/S3
  semantics, routes, or execution context behavior.

## Documentation Theme

The published MkDocs theme should feel like the application shell and workspace
surfaces, not like a separate marketing site.

- `doc/docs/assets/stylesheets/docs-theme.css` mirrors the app tokens from
  `frontend/src/index.css`. Keep the same `--ui-*` and `--shell-*` token names
  when changing documentation colors, borders, text, shadows, or active states.
- Documentation content surfaces should follow app workspace primitives:
  8px radius (`0.5rem`), `--ui-surface`, `--ui-surface-muted`,
  `--ui-border`, `--ui-border-soft`, `--ui-text`, `--ui-text-muted`,
  `--ui-hover`, `--ui-selected-bg`, and soft/no shadows.
- Documentation density should also follow the app workspace posture: compact
  headings, tight vertical rhythm, dense tables, compact primary navigation,
  compact table of contents, and screenshot chrome that leaves as much room as
  possible for the actual capture.
- Documentation chrome should follow app shell primitives:
  `--shell-topbar-bg`, `--shell-sidebar-bg`, `--shell-border`,
  `--shell-text`, `--shell-muted`, `--shell-hover`, and
  `--shell-selected-bg`.
- Do not introduce one-off documentation palettes such as separate blue,
  purple, teal, or gradient systems. If the app primary color changes, update
  the mirrored docs token scale in the same pass.
- Changing the default does not rewrite already persisted Admin branding
  values. Resetting settings loads the current default palette.
- Validate meaningful documentation theme changes with a strict MkDocs build,
  the screenshot reference check, and at least one desktop/mobile render smoke
  of a table-heavy docs page.

## Compact settings tokens

`components/settings/compactSettings.css` owns the opt-in settings geometry:
`--settings-content-width` (1120px), `--settings-title-width` (190px),
`--settings-section-gap` (12px top/bottom), `--settings-column-gap` (16px),
`--settings-row-height` (40px minimum), `--settings-row-padding` (6px) and
`--settings-control-height` (28px desktop / 44px below 1024px or with a coarse
pointer). Change these shared tokens instead of copying dimensions into page-specific styles. Rows
may grow for translated labels; do not clip text or reduce mobile targets.

Compact sections, inline status badges and the sticky action area use the
existing surface, border, text and primary palette tokens. Branding previews
scope generated primary variables to their demonstration container; they must
not call the global branding runtime until a server save succeeds. Check both
light and dark themes and a custom accent. Switches represent binary settings;
checkboxes remain for multiple selections and acknowledgements. Inheritable
booleans use an explicit three-state selector, with a separate Customize switch
for numeric and list overrides.

The compact presentation is explicit. Nonmigrated consumers keep the default
`SettingsLayout` presentation, including bucket configuration. Account Portal
overrides and Storage Space settings now use the compact presentation. The former
Portal alias facade and unused card/form helpers have been removed; import the
canonical components directly.

Settings typography is also tokenized: titles 14px/20px at weight 600, labels
13px/18px at weight 500, body/inputs 13px/18px at weight 400, descriptions and
buttons 12px/16px at weight 400. Use `settings-section-title`, `settings-label`,
`settings-body`, `settings-description` and `SettingsButton`; do not depend on
ad-hoc tiny text utilities or change the global `UiButton` defaults.
Dialog and action-bar spacing comes from `--settings-dialog-padding-x/y`,
`--settings-field-gap` and `--settings-actions-padding`. Heights are minimums,
so longer translated labels and validation messages can wrap without clipping.

## Listing tokens and exceptions

The `--list-*` scale centralizes 12px/18px text, 400/500/600 weights, 36px
minimum rows, 12px/4px cell padding, 28px controls with 8px inline padding,
6px action corners and 4px badge corners. Below 768px or with a coarse pointer,
controls use 44px targets. Do not use arbitrary `text-[12px]` utilities as a
substitute for the semantic classes; the global typography layer may normalize
those utilities differently.

Surfaces, borders, hover, selection and focus derive from `--ui-*`; primary
variants use the runtime brand scale. Success/warning/danger action colors and
association category colors are centralized in `listPresentation.css`.
`ListBadge` reuses `UiBadge` semantic palettes, while custom S3 tag colors remain
owned by the existing tag contract. Avatars, progress tracks and status dots
retain their geometric meaning.

A page may set column widths, scrolling, grouped-row geometry or Browser
density. It must not override action fonts, padding, corner radius or colors
with local chains. Desktop `ListActions` stays on a single line; mobile groups
wrap. `PageHeader`/`PageShell` opt in with `actionPresentation="listing"` and
page context inputs reuse `ui-list-control`, so unrelated form headers and
controls keep their existing appearance. See the
[presentation inventory](listing-presentation-inventory.md) for the exceptions
and validation command.
