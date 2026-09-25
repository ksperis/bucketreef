# Bucket feature cards design QA

## Source visuals

- `/Users/laurent/.codex/visualizations/2026/09/25/01a0d810-5fbd-7bf3-b88c-74dfa0ec8054/mockups/01-card-grid.png`
- `/Users/laurent/.codex/visualizations/2026/09/25/01a0d810-5fbd-7bf3-b88c-74dfa0ec8054/mockups/04-permissions-card-grid.png`
- `/Users/laurent/.codex/visualizations/2026/09/25/01a0d810-5fbd-7bf3-b88c-74dfa0ec8054/mockups/06-advanced-card-grid.png`

## Implementation captures

The final Playwright matrix covers Properties, Permissions and Advanced in every directory below.

| Surface | Theme | Viewport | Capture directory |
| --- | --- | --- | --- |
| Manager | light | 1440 x 900 | `frontend/test-results/bucketWorkbenchAudit-manager-bucket-feature-cards-light-1440/` |
| Manager | light | 390 x 900 | `frontend/test-results/bucketWorkbenchAudit-manager-bucket-feature-cards-light-390/` |
| Manager | dark | 1440 x 900 | `frontend/test-results/bucketWorkbenchAudit-manager-bucket-feature-cards-dark-1440/` |
| Manager | dark | 390 x 900 | `frontend/test-results/bucketWorkbenchAudit-manager-bucket-feature-cards-dark-390/` |
| Ceph Admin | light | 1440 x 900 | `frontend/test-results/bucketWorkbenchAudit-ceph--a660e-et-feature-cards-light-1440/` |
| Ceph Admin | light | 390 x 900 | `frontend/test-results/bucketWorkbenchAudit-ceph--414a3-ket-feature-cards-light-390/` |
| Ceph Admin | dark | 1440 x 900 | `frontend/test-results/bucketWorkbenchAudit-ceph--95b46-ket-feature-cards-dark-1440/` |
| Ceph Admin | dark | 390 x 900 | `frontend/test-results/bucketWorkbenchAudit-ceph--5b813-cket-feature-cards-dark-390/` |

Each directory contains `bucket-properties-*.png`, `bucket-permissions-*.png` and `bucket-advanced-*.png`.

## Comparison history

The first rendered pass exposed four material gaps against the mockups: configured collection cards also displayed an incorrect `Inactive` badge; the Manage column collapsed and wrapped Edit/Remove vertically; table rows became much taller than the reference; and the rich visual fixture exposed malformed ACL data plus missing SSE capabilities.

The final implementation removes the redundant collection state badge, keeps desktop row actions horizontal with compact rows, preserves the one-column responsive card layout with touch-sized controls, fixes the ACL fixture shape, and exposes SSE consistently in the Manager and Ceph Admin rich-bucket fixtures.

## Result

Passed. The final 8-case visual matrix completed without page errors or horizontal overflow, and the rendered hierarchy, density, configured-state treatment, table actions and responsive behavior match the three accepted card-grid references at the intended level of fidelity.
