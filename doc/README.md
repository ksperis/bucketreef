
# Documentation (MkDocs + Material)

This folder contains the MkDocs documentation for **BucketReef**.

Published at <https://docs.bucketreef.ksperis.com/> using Cloudflare Pages and
GitLab CI. See [Docs maintenance](docs/developer/en/documentation/maintenance.md#publication-and-build)
for deployment variables, DNS configuration and rollback.

## Quickstart

From repository root:

```bash
python -m venv .venv-docs
source .venv-docs/bin/activate
pip install -r doc/requirements.txt
python3 doc/build_docs.py --strict
python3 -m http.server 8000 --directory doc/site
```

Then open <http://127.0.0.1:8000/>. For live editing of one audience guide,
run `mkdocs serve -f doc/mkdocs.<guide>.yml`, for example
`mkdocs serve -f doc/mkdocs.manager.yml`.

## Source layout

The public site is assembled from a global selector and five audience guides.
Portal currently has both English and French trees:

- `doc/docs/admin/en/`
- `doc/docs/developer/en/`
- `doc/docs/manager/en/`
- `doc/docs/portal/en/`
- `doc/docs/portal/fr/`
- `doc/docs/browser/en/`

Shared assets remain under `doc/docs/assets/`. Each guide/language build has its
own navigation and search index; the global documentation root has no search
index. The build fails if the French Portal page set no longer mirrors the
English Portal page set.
