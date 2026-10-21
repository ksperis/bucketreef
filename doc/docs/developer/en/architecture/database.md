# Architecture: Database

## Defaults

- SQLite default for local runs (`app.db` or configured path).
- Alembic migrations under `backend/alembic/versions/`.

## Main model areas

- identities/users
- storage endpoints
- S3 accounts/users/connections
- audit and operational data
- bucket migration and health/cost data

## Schema diagrams

The database diagrams are generated from `app.db.Base.metadata`. The Mermaid
views are rendered directly by the Developer Guide, while the complete ChartDB
diagram contains every table, column, constraint, index and foreign-key
relationship in one interactive model.

Regenerate the Mermaid and ChartDB sources after a model change:

```bash
backend/.venv/bin/python backend/scripts/generate_database_schema_docs.py
```

Use `--check` to verify that committed generated files still match the current
SQLAlchemy metadata without modifying files. Every metadata table must belong to
exactly one documented domain, so a new table cannot silently disappear from
the diagrams.

### Overview

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/overview.mmd"
```

### Detailed Mermaid views

The detailed views include all columns in their local domain. Cross-domain
foreign keys keep a minimal external entity so the relationship remains visible
without duplicating another domain's full table definition.

<details markdown="1">
  <summary>Identity and UI access</summary>

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/identity-ui-access.mmd"
```

</details>

<details markdown="1">
  <summary>Storage and S3 execution</summary>

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/storage-s3-execution.mmd"
```

</details>

<details markdown="1">
  <summary>Tags and classification</summary>

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/tags-classification.mmd"
```

</details>

<details markdown="1">
  <summary>Portal</summary>

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/portal.mmd"
```

</details>

<details markdown="1">
  <summary>Operations and audit</summary>

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/operations-audit.mmd"
```

</details>

<details markdown="1">
  <summary>Observability, quota and cost</summary>

```mermaid
--8<-- "doc/docs/developer/en/architecture/database-schema/observability-quota-cost.mmd"
```

</details>

### Complete interactive model in ChartDB

[Download the generated ChartDB diagram](/assets/diagrams/database-schema/bucketreef-database.chartdb.json){ .md-button }

Open [ChartDB](https://app.chartdb.io/), choose **Import diagram**, and select
the downloaded JSON file. The generated canvas groups every application table
into the same six documented domains using native ChartDB Areas. Tables are
expanded and laid out deterministically so regenerating an unchanged model does
not move them or create noisy diffs.

The ChartDB file uses SQLite as its interchange dialect because SQLite is the
default local BucketReef database and ChartDB's JSON import workflow requires a
concrete database type. The SQLAlchemy model remains shared with PostgreSQL, and
the generated diagram is a structural model rather than a claim about the
production database engine.

## Operational note

Always apply schema migrations as part of deployment lifecycle.
