
# Documentation (MkDocs + Material)

This folder contains the MkDocs documentation for **BucketReef**.

Published at <https://docs.bucketreef.ksperis.com/> using Cloudflare Pages and
GitLab CI. See [Docs maintenance](docs/developer/docs-maintenance.md#publication)
for deployment variables, DNS configuration and rollback.

## Quickstart

From repository root:

```bash
python -m venv .venv-docs
source .venv-docs/bin/activate
pip install -r doc/requirements.txt
mkdocs serve -f doc/mkdocs.yml
```

Then open the local URL shown by MkDocs.

## Integrating into the repository

This ZIP is meant to be extracted into the repository as:

- `doc/mkdocs.yml`
- `doc/requirements.txt`
- `doc/docs/**`

If you already have a `doc/` folder, merge contents.
