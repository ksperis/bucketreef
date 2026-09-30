# Browser design QA — 28 September 2026

final result: passed

The target is the combination explicitly selected by the user: Image 1's path
bar, advanced search and unframed file icons; Image 2's Display submenu and Help
placement; Buckets/Favorites sidebar tabs with contextual subtitles. This is an
adaptation to BucketReef's shared components, not a full replacement of its shell.

## Evidence

Source visual truth:

- Two transient local reference images were used for the visual comparison.
  They are not repository artifacts.

Rendered implementation: authenticated `http://localhost:14173/browser` using
the isolated Moto harness. Local screenshots are in
`frontend/output/browser-evolutions/`: `search-dark.png`, `display-dark.png`,
`browser-light.png` and `search-mobile.png`. They are deliberately excluded
from the commit.

Sources: 1672 × 941 pixels. Desktop: 1728 × 972 CSS pixels and image pixels,
device scale factor 1. Mobile: 390 × 844, scale factor 1. No raster resampling.
The desktop sources and captures have essentially the same aspect ratio; the
existing compact density and 208-pixel shared sidebar are intentional. Source
content is illustrative French; captures use the harness's English labels and
small, real S3 fixtures. Object count is not treated as a geometry mismatch.

Each source and its implementation capture was opened together in the same
comparison input. Focused inspection covered sidebar tab labels and bucket-first
subtitles, path borders and separators, search padding and form fields, file icon
backgrounds, Display nesting and Help placement. The full-resolution comparison
made these regions readable, so separate cropped raster artifacts were unnecessary.

## Findings and comparison history

- P2, corrected: the context-first subtitle hid the bucket. It now starts with
  the bucket and path; full identity remains available through the item.
- P2, corrected: leftover icon color classes still painted decorative backgrounds.
  Object icons now render as outlines without tiles.
- P2, corrected: compact input padding could override the space reserved for the
  search icon. The shared list control selector now preserves icon padding.
- P2, corrected: advanced search was tied to the desktop table header. The mobile
  list now exposes the same search header and a viewport-bounded popover.
- Capture correction: waiting only for DOM visibility could capture Display before
  its animation-frame positioning. The scenario now asserts viewport intersection
  before capture; the final image shows both menus and Help.

The final same-state captures were inspected after these corrections. No actionable
P0/P1/P2 visual findings remain in the approved scope.

## Required fidelity surfaces

- Typography: native shared UI font, caption/body hierarchy and compact density
  retained. Sidebar names truncate within their column, and a second line
  distinguishes the location. The source image's font is not claimed as an exact
  identified typeface.
- Spacing/layout: one path bar, filters inside the search popover, favorites in
  the sidebar, Display in an adjacent submenu and Help at the bottom. Compact
  row heights and additional Advanced-profile actions are expected product
  differences from the illustrative mock.
- Colors/tokens: existing dark surfaces, light surfaces, blue selection/action
  color and yellow folder outlines retained. Focus remains visible in both themes.
  The mock's decorative gradients are not introduced into shared UI tokens.
- Image quality/assets: existing BucketReef logo retained; native object SVG icons
  kept sharp without frames; official Feather star/bookmark/help assets use their
  original vectors with license. No raster mock is embedded as interface content.
- Copy/content: locations and saved views are distinct; subtitles start with the
  bucket. Search scope, file-only filter behavior and local dates are explicit.
  Additional technical actions remain visible for the authenticated Advanced user.

## Interaction checks

The authenticated scenario covers saving a favorite and a view, synchronization in
a second browser context, applying a filter without text, search focus restoration,
ArrowRight/ArrowLeft for Display, Help, theme switching and mobile search. The
scenario's page-error collection is empty. Expected capability/network diagnostics
from the isolated fixture are distinct from uncaught application errors.

## Implementation checklist

- [x] Approved navigation, search, icons and menu changes.
- [x] Earlier visual findings corrected and captured again.
- [x] Desktop dark/light and mobile checks.
- [x] Keyboard interaction and no uncaught page errors in the combined UX scenario.

Provider compatibility and functional validation limits are documented separately
in `doc/docs/developer/browser-evolutions-validation.md`.
