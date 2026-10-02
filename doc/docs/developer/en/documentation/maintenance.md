# Documentation Maintenance

BucketReef documentation is organized as five audience guides plus a small
global site. Each guide owns its source tree, navigation, and search index.

## Source layout

```text
doc/docs/
├── index.md
├── releases.md                  # generated global release history
├── admin/
│   └── en/
├── developer/
│   └── en/
├── manager/
│   └── en/
├── portal/
│   ├── en/
│   └── fr/
├── browser/
│   └── en/
└── assets/
```

The guide and language are part of the public route. English uses
`/<guide>/en/...`. Portal also publishes a French guide under `/portal/fr/`.
Future translations are added beside the existing language without moving the
English sources.

The former `user/`, `ops/`, and unscoped `developer/` source trees are retired.
Do not add new pages there and do not create compatibility redirects for their
old public URLs.

## Audience ownership

Choose the guide from the reader's task, not from the implementation that
happens to render the screen.

| Guide | Owns |
|---|---|
| **Administration** | Deployment, configuration, security, Admin, Ceph Admin, Storage Ops, platform governance, observability, backup, recovery, and day-2 operations. |
| **Developer** | Architecture, contribution, local development, testing, CI/CD, releases, implementation records, API/reference, and documentation maintenance. |
| **Manager** | Account/context-scoped S3 administration: buckets, IAM, topics, Manager tools, and Browser behavior embedded in Manager. |
| **Portal** | Simple end-user and Portal Manager tasks around projects, Storage Spaces, files, collaboration, activity, capacity, external tools, and Help requests. |
| **Browser** | Standalone Browser contexts, object operations, versions, transfers, favorites, and Browser-specific troubleshooting. |

`portal_manager` is a Portal project role. It must never be documented as
Manager workspace access. Manager account access uses `account_administrator`.

When the same frontend Browser component appears in several workspaces, document
the host experience in that host guide. The standalone Browser guide remains the
complete reference for `/browser`; Portal users should not have to leave the
Portal guide to learn ordinary file tasks.

## Publication and build

The public documentation is published at
<https://docs.bucketreef.ksperis.com/>. The assembled site is built under
`doc/site/` by:

```bash
python3 doc/build_docs.py --strict
```

The orchestrator runs seven MkDocs configurations:

| Configuration | Source | Output | Search |
|---|---|---|---|
| `doc/mkdocs.yml` | global selector and releases | `/` | disabled |
| `doc/mkdocs.admin.yml` | `doc/docs/admin/en/` | `/admin/en/` | guide-local |
| `doc/mkdocs.developer.yml` | `doc/docs/developer/en/` | `/developer/en/` | guide-local |
| `doc/mkdocs.manager.yml` | `doc/docs/manager/en/` | `/manager/en/` | guide-local |
| `doc/mkdocs.portal.yml` | `doc/docs/portal/en/` | `/portal/en/` | guide-local |
| `doc/mkdocs.portal.fr.yml` | `doc/docs/portal/fr/` | `/portal/fr/` | guide/language-local, French tokenizer |
| `doc/mkdocs.browser.yml` | `doc/docs/browser/en/` | `/browser/en/` | guide-local |

`doc/mkdocs.base.yml` owns shared Material settings, Markdown extensions,
stylesheets, JavaScript, and other common assets.

The global site deliberately has no search index. Each guide/language build
emits its own `search/search_index.json`, so a search performed inside French
Portal stays inside French Portal, a Portal search cannot return a Developer
page, and a Manager search cannot return backend implementation documentation.

The build orchestrator validates the English guide page sets against the
[reorganization migration matrix](reorganization-matrix.md), requires the
French Portal tree to mirror the English Portal Markdown page set, verifies the
expected search indexes, and assembles one publishable `doc/site/` artifact.

## Portal translations

English remains the structural source for Portal documentation. Every Markdown
page under `portal/en/` must have the same relative path under `portal/fr/`.
When adding, moving, or removing a Portal page, update both trees in the same
change; `doc/build_docs.py --strict` enforces this parity.

Translate end-user prose and navigation labels, but keep stable technical
identifiers such as routes, S3 terms, product names, code values like
`portal_user`, and literal configuration values unchanged. Prefer the French
vocabulary already used by the Portal UI, for example **Espaces**, **Fichiers**,
**Collaborateurs**, **Outils externes**, **Historique**, **État du stockage**,
**Demandes**, and **Paramètres**.

The Portal MkDocs configurations expose English/French alternates. Application
help links select `/portal/fr/...` when the UI language is French and fall back
to English for guides that do not yet have that language.

GitLab CI validates documentation changes and publishes `doc/site/` to the
configured Cloudflare Pages project on the protected production workflow.
Keep publication credentials in protected CI variables; never commit or print
them.

## Canonical links and assets

Use normal relative Markdown links for pages inside the same guide. Use the
canonical public path for a deliberate cross-guide handoff, for example:

```markdown
[Manager guide](/manager/en/)
[Portal files](/portal/en/files/)
```

Cross-guide links should be exceptional in Portal and Browser task pages. They
are appropriate when the reader is explicitly being handed to another role or
responsibility.

### Application help links

The application resolves workspace documentation through
`frontend/src/navigation/documentation.ts`. Keep public documentation URLs in
that resolver instead of hardcoding them in workspace components. `Layout`
uses the active route and UI language to expose the corresponding guide from
the top bar; when a translation is unavailable, the resolver falls back to an
available guide language.

Embedded Browser help follows the host workspace. Browser operations opened in
Manager resolve to the Manager Browser pages, Portal file help stays in Portal,
and Ceph Admin Browser help stays in Administration. The standalone `/browser`
surface resolves to the Browser guide. Use the resolver's Browser topics for
operation- or version-specific links so a shared Browser component never has to
choose a guide by itself.

Backend-generated public documentation URLs must use the same canonical guide
paths. Production-readiness findings, for example, link to
`/admin/en/operations/production-checks/` and preserve their section anchors.

Shared documentation assets use an absolute site path:

```text
/assets/...
```

Do not calculate `../` depth from a guide page to `doc/docs/assets/`; every guide
is published below its own route root while assets are copied to the global
`/assets/` location.

Editable D2 diagram sources stay with the guide that owns their subject:
database-schema sources live under `developer/en/architecture/`, while
production-deployment D2 sources live under `admin/en/install/diagrams/`.
Rendered SVGs remain shared assets under `doc/docs/assets/diagrams/`.

## Coverage expectations

Keep route and task coverage in the guide that owns the experience.

| Surface / feature | Canonical documentation |
|---|---|
| Guide selection | `index.md` |
| Admin workspace | `admin/en/platform/index.md` |
| Effective access | `admin/en/platform/access-audit.md` |
| Endpoint health | `admin/en/platform/endpoint-status.md` |
| Usage / billing operations | `admin/en/platform/usage-metrics.md`, `admin/en/operations/` |
| Ceph Admin | `admin/en/storage/ceph-admin/` |
| Storage Ops | `admin/en/storage/storage-ops/` |
| Deployment / production operations | `admin/en/install/`, `admin/en/operations/`, `admin/en/security/` |
| Manager workspace | `manager/en/index.md` |
| Manager buckets | `manager/en/buckets/` |
| Manager IAM / access keys | `manager/en/iam/` |
| Manager topics | `manager/en/topics.md` |
| Manager tools | `manager/en/tools/` |
| Manager embedded Browser | `manager/en/browser/` |
| Portal | `portal/en/index.md`, mirrored in `portal/fr/index.md` |
| Portal Storage Spaces | `portal/en/spaces/`, mirrored in `portal/fr/spaces/` |
| Portal files and versions | `portal/en/files/`, mirrored in `portal/fr/files/` |
| Portal collaboration | `portal/en/collaboration.md`, mirrored in `portal/fr/collaboration.md` |
| Portal capacity / activity / requests | `portal/en/storage-health.md`, `portal/en/activity.md`, `portal/en/help-requests.md`, mirrored under `portal/fr/` |
| Standalone Browser | `browser/en/index.md` |
| Browser object operations | `browser/en/objects/operations.md` |
| Browser versions | `browser/en/objects/versions.md` |
| Contributor onboarding | `developer/en/contributing/` |
| Architecture | `developer/en/architecture/` |
| Developer/testing reference | `developer/en/reference/`, `developer/en/testing/` |

When a route or feature changes, update the page for that reader and update
operator/developer documentation only when their contract also changed. Do not
create a generic page spanning several guides solely to avoid duplication.

## Screenshot workflow

Application screenshots remain under:

```text
doc/docs/assets/screenshots/user/
```

A guide page that needs a theme-aware screenshot uses the canonical asset path:

```html
<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/<name>.light.png" alt="..." loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/<name>.dark.png" alt="..." loading="lazy">
</div>
```

Pages are not required to contain exactly one screenshot. A concise task page
may need none, while a deliberate gallery may contain several. The checker
validates every themed block that is actually referenced across all five guide
trees, verifies matching light/dark basenames, canonical `/assets/...` paths,
file existence, and 1728x972 dimensions. It also detects unreferenced screenshot
files.

Generate the maintained application screenshots with:

```bash
npm --prefix frontend run docs:screenshots
```

Validate them with:

```bash
npm --prefix frontend run docs:screenshots:check
```

The curated all-workspace gallery lives at
`developer/en/documentation/screenshots-gallery.md` because it is a
maintenance/reference page rather than end-user navigation.

## Visual theme maintenance

Use the shared `--docs-*` tokens in
`doc/docs/assets/stylesheets/docs-theme.css`. Keep the documentation reading
layout coherent in light and dark modes and preserve Material's responsive
navigation, search, anchors, and keyboard behavior.

After a documentation-theme change, check representative pages from the global
selector and each guide at desktop and mobile widths. Temporary browser captures,
Playwright reports, and traces stay outside the repository.

## Required validation

Before publishing a documentation reorganization or content change, run:

```bash
python3 doc/build_docs.py --strict
npm --prefix frontend run docs:screenshots:check
git diff --check
```

For changes to the build orchestrator, also syntax-check it:

```bash
PYTHONPYCACHEPREFIX=/tmp/bucketreef-docs-pycache python3 -m py_compile doc/build_docs.py
```

A successful multi-guide build must contain the global selector and releases,
all five `/<guide>/en/` roots, one search index under each guide, and no global
`/search/search_index.json`.
