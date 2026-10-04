# Backends: Ceph RGW

Ceph RGW is a primary target, especially when RGW Accounts are available.

## What is typically used

- S3 APIs for buckets/objects/configuration.
- IAM APIs for principals and policies.
- RGW Admin Ops for account and operational controls.
- Usage logs and metrics for quota, billing, and capacity views when enabled.
- RGW SNS topic APIs when event workflows are available on the endpoint.

## Operational considerations

- Validate feature support per Ceph release.
- Consider multisite implications in production.
- Document cluster-specific limits for your organization.
- Separate Admin Ops (bootstrap and mutations), Runtime Read Ops (Manager/Portal live
  reads), and Supervision Ops (monitoring and collection). Runtime has
  `accounts=read;user-info-without-keys=read;buckets=read`; Supervision has
  `usage=read;buckets=read`. Neither identity may carry write caps or admin/system flags.
- BucketReef proposes managed service identities when Admin Ops has `users=write`.
  External mode remains available. Without `users=write`, provide Runtime externally
  and Supervision when Metrics or Usage is enabled.
- Give the RGW Admin Ops identity `buckets=write` only when Manager bucket quota
  management is enabled. The per-account or per-user
  `allow_bucket_quota_management` grant authorizes a BucketReef target; it does
  not add capabilities to the RGW service identity.
- If the S3 endpoint URL is not the RGW Admin Ops URL, configure the dedicated
  Admin endpoint override instead of relying on the S3 endpoint as a fallback.
- Test lifecycle, notifications, versioning, object lock, bucket policy, CORS, website, logging, and replication on the target Ceph release before promising them to tenants.
- Validate account quota behavior on the target release before enabling quota-management workflows.
- Enable Manager Ceph S3 User key management only for managed S3 User contexts
  where operators are allowed to create, disable, enable, or delete RGW access
  keys. The global Manager setting, user or group tool access, the S3 User allow
  flag, and Admin Ops credentials must all line up.

## Admin Ops capability for Manager bucket quotas

Manager updates an individual bucket through `PUT /admin/bucket`. Ceph requires
the Admin Ops identity signing that request to have `buckets=write`.
`accounts=write` authorizes account-level quota operations, but it does not
authorize an individual bucket quota update.

Create Admin Ops with the mandatory read permissions:

```bash
radosgw-admin user create --uid="bkr-admin" --display-name="BucketReef Admin Ops" \
  --caps="users=read;accounts=read"

# Optional: managed service identities, user provisioning and user quotas
radosgw-admin caps add --uid="bkr-admin" --caps="users=write"
# Optional: RGW Account provisioning and account quotas (root creation also needs users=write)
radosgw-admin caps add --uid="bkr-admin" --caps="accounts=write"
# Optional: delegated individual bucket quota changes
radosgw-admin caps add --uid="bkr-admin" --caps="buckets=write"
# Optional: enable the Usage feature (absence disables it)
radosgw-admin caps add --uid="bkr-admin" --caps="usage=read"
# Optional: future usage administration; never required by the collectors
radosgw-admin caps add --uid="bkr-admin" --caps="usage=write"
```

For externally provisioned service identities:

```bash
radosgw-admin user create --uid="bkr-runtime-read" --display-name="BucketReef Runtime Read Ops" \
  --caps="accounts=read;user-info-without-keys=read;buckets=read" --max-buckets=0
radosgw-admin user create --uid="bkr-supervision" --display-name="BucketReef Supervision Ops" \
  --caps="usage=read;buckets=read" --max-buckets=0
```

The [Ceph capability reference](https://docs.ceph.com/en/latest/radosgw/admin/)
includes `user-info-without-keys`. Qualify it on your Ceph release: Runtime user
lookups must return no S3, Swift or temporary keys. BucketReef rejects broad caps
and admin/system flags rather than using Admin Ops as a fallback.

Managed identities have distinct installation/endpoint-based UIDs, encrypted
secrets, ownership provenance, and resumable states. Saving an endpoint creates
Runtime; Supervision is created only for Metrics or Usage. Feature detection is
read-only: Admin Ops bootstraps feature inspection, followed by functional service
identity checks at save/apply. Failures appear in the endpoint's credentials tab;
use **Retry service identity configuration** after fixing RGW access.

Existing Supervision credentials migrate as external without changing their RGW
users. Existing endpoints need Runtime configured before live enrichment resumes.
Selecting managed mode explicitly converts Runtime/Supervision and preserves the
external users. Generated DB secrets survive ENV synchronization.

Enable Ceph Admin through **General settings → Ceph Admin** and select the allowed
Ceph endpoints. `users=write` is required. Ceph Admin identities are always managed
by BucketReef and cannot be supplied through the endpoint API, onboarding,
`ENV_STORAGE_ENDPOINTS`, or seed variables. The optional workspace grant to the
current user is unchecked by default. Access is active only when the global feature,
endpoint authorization and managed identity readiness all hold. Disabling the global
feature preserves endpoint authorizations and immediately blocks access, then removes
managed users without purging data.
A failed remote removal stays `revocation_pending` until a confirmed retry succeeds.

## Minimum lab validation

1. Configure a Ceph endpoint and run healthchecks.
2. Create or import an RGW account.
3. Select the account in Manager and list buckets.
4. Validate IAM user or policy listing when IAM is enabled.
5. Run Browser upload/download on a small object.
6. If S3 User key lifecycle is delegated to Manager, create a disposable key,
   verify it once with an external S3 client, then disable or delete it.
7. Confirm usage-history or metrics collection if the deployment exposes quota, billing, or Portal usage.

## Related pages

- [Backends: compatibility matrix](compatibility.md)
- [Workspace: Ceph Admin](../ceph-admin/index.md)
- [Feature: Ceph access keys in Manager](/manager/en/iam/access-keys/)
- [Production readiness](../../operations/production-readiness.md)
