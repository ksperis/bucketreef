# Repository Layout

## Main directories

- `backend/`: FastAPI code, migrations, scripts, tests.
- `frontend/`: React UI, tests, build tooling.
- `doc/`: MkDocs documentation.
- `deploy/`: Helm chart and the shared image-based deployment bundle used by Compose and QuickStart.
- `ops/`: operational helper scripts (cron jobs, etc.).

## Key files

- `compose.yaml`: source builds only.
- `doc/mkdocs.yml`
