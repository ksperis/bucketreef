# Error-page design QA — 2026-09-28

final result: passed

## Visual truth and implementation

Source directory: `/Users/laurent/.codex/generated_images/01a0e36a-6056-7f83-950d-c1514b2278af/`.

- Light 404: `exec-59e78089-5644-4356-999f-996678e8215a.png`.
- Dark 404: `exec-035917d9-a2b4-4c89-8a38-cc3e117560a8.png`.
- Dark 403: `exec-95714b36-660e-49a6-b18f-9bcee51cda3c.png`.

Browser-rendered implementation captures:

- `frontend/test-results/errorPagesVisualQa-light-full-page-not-found/not_found-light.png`
- `frontend/test-results/errorPagesVisualQa-dark-full-page-not-found/not_found-dark.png`
- `frontend/test-results/errorPagesVisualQa-dark-full-page-forbidden/forbidden-dark.png`
- `frontend/test-results/errorPagesVisualQa-dark-admin-retains-navigation-on-404/admin-dark.png`
- `frontend/test-results/errorPagesVisualQa-bootstr-04d1f-n-place-without-signing-out/unavailable-dark.png`
- `frontend/test-results/errorPagesVisualQa-light-m-0fb68-covery-controls-stay-usable/mobile-light.png`
- `frontend/test-results/errorPagesVisualQa-dark-mobile-recovery-controls-stay-usable/mobile-dark.png`

Desktop source and implementation: 1487 × 1058 pixels, CSS viewport 1487 × 1058,
deviceScaleFactor 1. No crop/density conversion. French copy, closed diagnostics,
light/dark, authenticated fixture so the workspace recovery action is available.
Mobile viewport: 390 × 844 CSS pixels, full-page screenshot 390 × 861 pixels.
There is no mobile source; mobile is a responsive usability check, not a pixel match.

Full source/capture pairs were opened together in the same image-tool result,
first for the 404 light and dark views, then again after corrections. The 403
source/capture were compared together too. Text and controls were legible at
native capture size, so no separate crop was necessary. The unavailable view and
workspace/mobile captures were inspected directly as additional states.

## Comparison history

1. Initial captures: the brand wordmark inherited link blue, body copy felt too
   small in the full-page composition, and the common transparent art was too
   bright on dark backgrounds (P2 polish/consistency issues).
2. Fixed the brand span to the shared text token, increased full-page description
   to 20px while retaining compact workspace/mobile sizing, and applied 0.85
   brightness in the dark theme. Regenerated the browser captures/tests.
3. Compared updated source/capture pairs: no remaining actionable P0/P1/P2 findings.

## Required fidelity surfaces

- Typography: existing application font, 48px/700 full-page headline, 40px embedded,
  20px full-page body and 16px mobile, readable wraps. This is the requested style
  adapted to shared application typography, not a pixel-for-pixel image clone.
- Layout: spacious text-left/art-right desktop; one column on mobile with recovery
  first. Embedded variant preserves the actual navigation and avoids nested main
  landmarks. Desktop keeps the application's denser shared buttons.
- Tokens: application light/dark background, foreground, muted text, borders and
  primary action; restrained semantic accents. Orange remains in the existing logo.
- Assets: three locally served 900 × 720 transparent WebP illustrations retain
  the chosen blue octopus, map, key/shell and disconnected-cable direction.
  Images are sharp at rendered size, with no rectangular background or visible halo.
- Copy/content: factual explanation, contextual recovery, French and English.
  The source's Help link is replaced by the administrator-support footer because
  the application has no dedicated support destination. Previous page appears only
  with usable in-app history. These are intentional product adaptations.

## Interaction and implementation checks

22 fixture-backed browser scenarios passed in both themes: public error pages,
all six workspace 404s, mobile no horizontal overflow, loaded illustrations,
collapsed/revealed diagnostics, single main landmark, contextual home and recovery
from bootstrap 503 without navigating to login. Public error fixtures reported no
uncaught page errors. A live local public 404 was also inspected in Codex Browser.
An authenticated request rejected by the refresh endpoint also reaches the session-ended page.
Unit tests cover clipboard whitelisting, Retry-After, focus/a11y and session recovery.

No live Ceph or S3 authorization claim is made. Remaining non-visual repository
check failures (pre-existing unused exports and total bundle budget) are recorded
separately in the final validation report.
