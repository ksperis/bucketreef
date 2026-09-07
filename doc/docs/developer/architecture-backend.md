# Architecture: Backend

## Location

- Main entrypoint: `backend/app/main.py`
- Routers: `backend/app/routers/`
- Services: `backend/app/services/`

## Router groups

- Auth/users
- Admin
- Manager
- Portal
- Browser
- Ceph Admin
- Internal cron endpoints

## Feature gating

Router dependencies enforce global feature enablement (`require_*_enabled`).

## Error behavior

Backend preserves storage/API denial semantics and logs server-side details.

## API models

All application request and response DTOs inherit from
`app.models.base.ApiModel`. This boundary rejects unknown properties; do not
inherit directly from Pydantic's `BaseModel` for an application API schema.
FastAPI-generated form and multipart schemas are the only exceptions.

## Service boundaries

- Routers validate the HTTP boundary and call services.
- Services own business rules, storage execution choices, and audit metadata.
  The central audit policy rejects data-plane and operational-noise actions
  before persistence.
- Client modules wrap S3, IAM, RGW Admin Ops, or external integrations.
- Models and migrations define persistence; do not encode new authorization semantics only in the frontend.
- `FirstAdminBootstrapService` is the single boundary for first-user creation.
  Its CLI and API callers share email/password validation, the empty-database
  invariant, atomic singleton consumption and secret-free auditing.

## S3 download lifetime

Browser object downloads, Portal Storage Space downloads, and Portal public
links return an internal `S3ObjectDownload` from their service. This transfers
ownership of the open SDK `StreamingBody` to the shared `S3DownloadResponse`;
services must not discard it by returning only a chunk iterator.

The response streams one-MiB chunks without loading the whole object and keeps
the shared attachment-header encoding. It closes the provider body after
success, read/send failure, or client disconnection, including cancellation
before the first chunk. Cleanup runs outside the event loop and is shielded
from request cancellation. A response-construction failure also closes the
body. This lifecycle does not change execution identities, authorization,
public-link status checks, SSE-C parameters, or version selection.

Portal text previews and access-log readers consume their SDK bodies inside a
`contextlib.closing` scope so success and read failures both release the
provider connection. Text previews request and read at most 64 KiB, even when
the provider ignores the requested byte range; access-log reads retain the
complete object. A missing response body is not treated as an empty file:
previews report it as unavailable and log reads fail explicitly. A genuine
empty body remains valid, and a log object deleted after listing is still
ignored on `NoSuchKey`/not-found responses.

## Operational routes

Internal cron routes are not UI routes. Keep them token-protected and documented
in Ops pages when scheduler behavior changes. Their health, billing, and usage
collection runs are operational telemetry rather than application audit rows.

See [Audit boundary](audit-boundary.md) before adding any audit producer.
