# Recommended production architecture

For production, split BucketReef administration from day-to-day user access.
Run each runtime pool with multiple instances behind its own ingress and use a
shared PostgreSQL database as the application source of truth.

## Standard production topology

[![Recommended BucketReef production topology](/assets/diagrams/deployment-architecture/recommended-topology.svg)](/assets/diagrams/deployment-architecture/recommended-topology.svg)

The standard topology has two BucketReef runtime pools:

- **Administration pool** behind a restricted host such as
  `admin.bucketreef.example.com`. The `admin` deployment profile mounts
  `/admin`, `/ceph-admin`, and `/storage-ops` and owns scheduled jobs.
- **User access pool** behind the user-facing host such as
  `bucketreef.example.com`. The `user` deployment profile mounts `/manager`,
  `/portal`, and `/browser` and does not own scheduled jobs.

Run two or more backend/frontend instances per pool when high availability is
required. Both pools must point at the same PostgreSQL database and use the same
UI JWT, API JWT, and credential key rings so identities, sessions, encrypted
credentials, endpoint configuration, and application state remain coherent.
SQLite is not a supported database for this split multi-instance topology.

Configure the exact public origins for both hosts and a common WebAuthn RP ID
valid for those hosts. Restrict the Administration ingress at the network layer
to the intended administrator population. The User access ingress can follow
the organization's normal user exposure policy.

The deployment profiles enforce the surface split with runtime feature locks
such as `FEATURE_ADMIN_ENABLED`, `FEATURE_CEPH_ADMIN_ENABLED`,
`FEATURE_MANAGER_ENABLED`, `FEATURE_PORTAL_ENABLED`, and
`FEATURE_BROWSER_ENABLED`. In production, a split profile refuses to start when
its runtime surface locks do not match the selected profile. Common
authentication/profile APIs still exist where required by each profile and are
omitted from the diagram for clarity. Admin API-token management and the
first-administrator web bootstrap are not mounted on the `user` runtime.

Ceph RGW is intentionally shown as one external dependency. User runtimes use
S3/IAM according to the selected execution context. Administration runtimes use
RGW Admin Ops only for features that require it; do not grant write caps merely
because the endpoint is registered in BucketReef.

## Dedicated Ceph Admin alternative

Keep the main Administration deployment on `admin`, disable Ceph Admin with
`FEATURE_CEPH_ADMIN_ENABLED=false`, and run a separate `full` instance with only
Ceph Admin enabled. Disable its scheduled jobs and workers, restrict its ingress,
and give it its own PostgreSQL database, key rings and RGW identity. Do not store
that privileged identity on the main instance.

[![BucketReef production topology with dedicated Ceph Admin](/assets/diagrams/deployment-architecture/high-security-topology.svg)](/assets/diagrams/deployment-architecture/high-security-topology.svg)

This isolated database requires a separate administrator bootstrap. The sole
Ceph Admin surface enables that bootstrap and grants the first administrator
Ceph Admin access. The User access pool stays unchanged. Sharing a database and
credential ring would preserve cross-instance access to secrets; surface flags
alone are not a secret boundary.

See [Dedicated Ceph Admin instance](../security/ceph-admin.md) for the complete
Compose/Helm configuration and upgrade instructions.

## Helm contract for this topology

The chart ships `values-admin.yaml` and `values-user.yaml` selectors. The default
profile is `full`. Admin enables Ceph Admin by default; disable it using
`backend.env.FEATURE_CEPH_ADMIN_ENABLED: "false"` when required. A dedicated
Ceph Admin instance uses `full` with an operator-owned values file.

These files select runtime surfaces only. They do **not** configure production
hosts, replica counts, PostgreSQL, Secrets, TLS, trusted proxies, origins, or
NetworkPolicy selectors/egress. Supply those settings in operator-owned values
files for each release.

For the recommended HA split, each operator values file should at least define
the release-specific ingress host/TLS settings, `backend.replicas` and
`frontend.replicas`, `backend.databaseType=postgresql`,
`backend.persistence.enabled=false`, `backend.existingSecret`, the exact
trusted proxy CIDRs, the shared public/WebAuthn origin contract, and the strict
NetworkPolicy selectors and required egress rules. If PostgreSQL or RGW lives on
a private network, add only its exact CIDR/port under
`networkPolicy.privateEgress`.

The referenced `backend.existingSecret` is the source of `DATABASE_URL` and the
JWT/credential key rings. Do not put `DATABASE_URL` or those key rings in
`backend.env`; chart rendering rejects that configuration.

See [Deploy with Helm](helm.md) for concrete values and rendering rules.

## Strict RGW account provisioning with read-only Admin Ops

Organizations that do not want the BucketReef endpoint Admin Ops identity to
create RGW accounts can provision them in an external trusted workflow and then
import them into BucketReef.

[![Strict external RGW account provisioning and BucketReef import](/assets/diagrams/deployment-architecture/strict-account-import.svg)](/assets/diagrams/deployment-architecture/strict-account-import.svg)

The existing `POST /api/admin/accounts/import` path supports this model without
an API change when the RGW resources are prepared completely before the import:

1. The external provisioning tool creates the RGW account.
2. It creates the account-root RGW user expected by BucketReef, named
   `<RGW_ACCOUNT_ID>-admin`, and ensures that user has one complete access-key
   pair available through RGW Admin Ops.
3. BucketReef validates the account with Admin Ops, reads that root user and
   obtains its existing key pair.
4. BucketReef stores the account locally. The secret key is persisted through
   BucketReef's encrypted credential field and therefore depends on the shared
   credential key ring.

For **this pre-provisioned import path only**, the endpoint Admin Ops identity
can be restricted to:

```text
accounts=read; users=read
```

No RGW write is required when both the expected account-root user and a complete
key already exist. If the root user is missing, BucketReef's current import
fallback attempts to create it. If the user exists without a complete key,
BucketReef attempts to create a key. Those fallbacks require `users=write` and
must not be considered compatible with the read-only profile.

Native account provisioning from BucketReef is a different workflow. It creates
the RGW account and its root identity and therefore requires at least
`accounts=read,write` and `users=read,write`. Features such as delegated bucket
quota changes or Ceph Admin operations can require additional RGW capabilities;
the read-only caps above are not a general replacement for their documented
permissions.

The external-provisioning model removes RGW **write capabilities from the
endpoint Admin Ops identity** used by the import path. BucketReef still stores
the imported account's root credentials because Manager and Portal account
workflows use that explicit storage execution identity.

## Deployment notes

- With Helm, deploy the profile appropriate to each pool as separate releases
  with distinct ingress hosts and one shared PostgreSQL/key-ring contract.
- With Docker Compose, use distinct project names and the matching `admin` or
  `user` overlay. A dedicated Ceph Admin project uses the base Compose file with
  explicit feature switches in its own env file.
- Run scheduled jobs from the Administration deployment only.
- Apply network policy or firewall rules so Administration and dedicated Ceph
  Admin ingresses are reachable only from their intended operator networks.
- Back up PostgreSQL and preserve the credential key ring together; losing the
  key ring makes encrypted stored secrets unusable.

## Related pages

- [Deploy with Helm](helm.md)
- [Deploy with Docker Compose](docker-compose.md)
- [Production readiness](../operations/production-readiness.md)
- [Dedicated Ceph Admin instance](../security/ceph-admin.md)
- [Backends: Ceph RGW](../storage/backends/ceph-rgw.md)
- [Configuration](../configuration/index.md)
