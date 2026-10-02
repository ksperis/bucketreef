# Repository Layout

## Main directories

- `backend/`: FastAPI code, migrations, scripts, tests.
- `frontend/`: React UI, tests, build tooling.
- `doc/`: MkDocs documentation.
- `deploy/`: Helm chart and the shared image-based deployment bundle used by Compose and QuickStart.
- `ops/`: operational helper scripts (cron jobs, etc.).

## Key files

- `compose.yaml`: source builds only.
- `doc/mkdocs.base.yml`: shared MkDocs theme, Markdown and asset configuration.
- `doc/mkdocs.yml`: global guide selector and release-history build.
- `doc/mkdocs.<guide>.yml`: audience-scoped navigation and search configuration.
- `doc/build_docs.py`: assembles the global shell and five guide builds into `doc/site/`.
