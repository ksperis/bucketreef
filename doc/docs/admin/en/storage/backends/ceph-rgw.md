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
- Every Ceph endpoint has Runtime and Supervision identities, independently of
  enabled features. The recommended setup uses managed identities and Admin Ops
  with provisioning plus account/user quota permissions. Individual bucket quota
  changes require the optional `buckets=write` capability. External identities and
  reduced Admin Ops permissions are an advanced hardening choice.
- Without `users=write`, provide both Runtime and Supervision externally. Disabling
  Metrics, Usage or signed S3 healthchecks stops their use, without revoking identities.
- Account, Usage Log, and Metrics availability is detected from RGW credentials. A
  detected service can still be disabled in the endpoint configuration; a service that
  is not detected as available remains read-only in the UI.
- In the advanced restricted profile, give Admin Ops `buckets=write` only when
  Manager bucket quota management is enabled. The per-account or per-user
  `allow_bucket_quota_management` grant authorizes a BucketReef target; it does
  not add capabilities to the RGW service identity.
- If the S3 endpoint URL is not the RGW Admin Ops URL, configure the dedicated
  Admin endpoint override instead of relying on the S3 endpoint as a fallback.
- Configure the final Admin Ops URL directly. BucketReef does not follow HTTP
  redirects for signed Admin Ops requests because the SigV4 signature is bound
  to the requested URL. An HTTP-to-HTTPS redirect is reported as a configuration
  error; point the endpoint or Admin endpoint override at the HTTPS URL instead.
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

For evaluation and normal operation, create the recommended Admin Ops identity:

```bash
radosgw-admin user create --uid="bkr-admin" --display-name="BucketReef Admin Ops" \
  --caps="users=read,write;accounts=read,write"
```

This enables provisioning, account/user quotas and managed technical identities.
Individual bucket quota changes remain unavailable until `buckets=write` is added.
Runtime reads and monitoring use separate restricted identities. Admin Ops does
not need Usage capabilities. Ceph Admin remains separately authorized and always uses externally supplied keys.

### Advanced: restrict Admin Ops permissions

Reduced-permission profiles are documented here rather than offered in the
Credentials tab or setup assistant. The interface keeps the recommended command
and the managed/external identity choice. Creation commands are folded away when
credentials are already configured.

For externally provisioned resources, start with the mandatory read permissions
and add only the administration capabilities required by your workflows:

```bash
radosgw-admin user create --uid="bkr-admin" --display-name="BucketReef Admin Ops" \
  --caps="users=read;accounts=read"

# Optional: managed service identities, user provisioning and user quotas
radosgw-admin caps add --uid="bkr-admin" --caps="users=write"
# Optional: RGW Account provisioning and account quotas (root creation also needs users=write)
radosgw-admin caps add --uid="bkr-admin" --caps="accounts=write"
# Optional: delegated individual bucket quota changes
radosgw-admin caps add --uid="bkr-admin" --caps="buckets=write"
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
secrets, ownership provenance, and resumable states. In the interactive Admin UI,
Runtime and Supervision are shown as **Creation planned** before the initial save
and **Not created** on a saved endpoint awaiting managed provisioning. When Admin Ops
credentials are present and validated with `users=write`, the primary action becomes **Save endpoint & create managed identities** (or **Save & create
managed identities** while editing). BucketReef persists the endpoint first as
`not_provisioned`, then creates both identities, validates Runtime access, bucket
statistics and Usage, and keeps the editor open on the resulting state. If Admin Ops
is not ready, the endpoint can still be saved without remote provisioning and later
completed with **Create managed identities**. Feature detection remains read-only:
Admin Ops inspects administration and Account support, while Supervision is the sole
identity used to probe Usage. Empty usage data does not block identity readiness, but
Usage availability needs recorded traffic. After an attempted provisioning failure,
fix RGW access and use **Retry configuration**.

Existing Supervision credentials migrate as external without changing their RGW
users. Existing endpoints need Runtime configured before live enrichment resumes.
Selecting managed mode explicitly converts Runtime/Supervision and preserves the
external users. With validated Admin Ops `users=write`, **Save & create managed
identities** persists the conversion first and then provisions the managed RGW users.
Without that capability the conversion may be saved as `not_provisioned` and completed
later. Generated DB secrets survive ENV synchronization.

Every Ceph entry in `ENV_STORAGE_ENDPOINTS` must explicitly declare
`service_identity_mode: managed` or `service_identity_mode: external`. Omission is
a startup error, including on instances without Admin. The API still defaults new
endpoints to managed mode; this breaking requirement applies to ENV inventories.

`ENV_STORAGE_ENDPOINTS` uses the same credential requirements as the endpoint API.
For every Ceph endpoint in external mode, provide complete Runtime and Supervision
pairs, even when monitoring features are disabled. The entire inventory
is validated before synchronization. An incomplete entry prevents startup, even if
another replica is already synchronizing endpoints; no earlier entry is applied.

For managed identities, BucketReef accepts the current S3 key and the old/new keys recorded in the durable journal
during an unfinished rotation. Any additional S3 key (including a
disabled key), Swift key or temporary URL key is key drift. Reconciliation or rotation
marks the identity `error`, blocks its operational client and records a secret-free
audit event. Revocation remains `revocation_pending` and does not delete the user.
BucketReef never adopts or removes unexpected keys automatically. Inspect the RGW
user, remove the unexpected keys externally, then retry service identity configuration
or pending revocation. These ownership rules do not restrict external identities.

Configure **Ceph Admin** in an endpoint's **Credentials** tab: expand **Prepare
Ceph Admin keys**, enter both keys and enable its endpoint authorization. These
fields are independent of the Runtime/Supervision management mode and remain
available while the global feature
is disabled. Enable the workspace in **General settings → Ceph Admin**. User access
is assigned separately through user/group settings, or explicitly by onboarding.

Create the dedicated RGW user externally, for example:

```bash
radosgw-admin user create --uid="bkr-ceph-admin" \
  --display-name="BucketReef Ceph Admin" --admin --system=false
```

Ceph Admin requires `admin=true`, `system=false` and authentication with its own
pair; `users=write` on Admin Ops is not required for this validation. BucketReef
never sets the admin flag via REST. Endpoint and onboarding forms accept the keys;
ENV entries use `ceph_admin_access_key` and `ceph_admin_secret_key`. Leave both
fields empty while editing to retain stored credentials; replacing them requires
both values. Secrets and Ceph Admin access-key IDs are absent from read responses.

Access requires global enablement, endpoint authorization and a validated external
identity with complete credentials. Disabling access preserves the pair and never
changes the RGW user. Rotate it externally and supply the replacement pair.

Migration `0143_external_ceph_admin_credentials` preserves complete Ceph Admin pairs
from `0.2.13` while removing managed-only UIDs, provenance, validation state and
pending rotations. The preserved pair is revalidated after upgrade; re-enter it only
when it is incomplete or invalid. Migration intentionally resets per-endpoint Ceph
Admin authorization to disabled, so explicitly re-enable it after validating the
preserved credentials. Existing RGW users remain untouched; inspect and clean up
obsolete users and keys manually, without purging buckets or data.

## Revalidation and recovery

An unavailable Admin Ops bootstrap preserves previously ready technical identities.
A temporary failure of their functional checks preserves ready state and displays an
explicit error. Rejected credentials, invalid capabilities, Runtime key disclosure,
missing ownership proof and unexpected managed keys block the affected identity.
There is no fallback to Admin Ops for live reads or monitoring.

Renaming an endpoint or resynchronizing an identical external credential pair keeps
its validation state. Changing the pair or RGW target requires revalidation. Removing
`users=write` preserves ready managed identities; restore it to create, convert or
rotate them. Both fields are required to replace an external service credential pair. Expand
**Replace Runtime keys** or **Replace Supervision keys** to enter a replacement;
leave both fields empty to retain the stored pair.

The Credentials tab groups each service identity with its saved configuration state
and current access check. **Configured** is a saved state, not proof that a current
check succeeded. Diagnostics and monitoring checks expand inline; missing usage data
is distinct from rejected access. A draft mode change displays **Pending save** and
its effect before the saved configuration is replaced. Admin Ops permission details
are folded when complete and remain visible when required capabilities are missing.

Administration instances and dedicated Ceph Admin instances reconcile persisted
Ceph endpoints at startup, recovering interrupted Runtime/Supervision provisioning
and revocations and retrying pending validation of supplied Ceph Admin pairs. Missing
Ceph Admin keys are never generated. A managed Runtime/Supervision identity explicitly
saved as **not provisioned** is not created by startup reconciliation; interactive
provisioning still requires the explicit combined save/create action or the later
**Create managed identities** action. Declarative `ENV_STORAGE_ENDPOINTS`, seed setup
and the setup assistant provision managed identities automatically because those flows
already express provisioning intent. Manager/Portal/Browser instances preserve shared
identity state without RGW mutations. Revocation of an unprovisioned or already revoked
identity needs no remote write; confirming an absent principal needs read access, while
deleting an existing principal requires `users=write`. Endpoint deletion remains locked
through the database commit.

Use **Save endpoint & create managed identities** when creating an endpoint with
validated Admin Ops, **Create managed identities** for a saved `not_provisioned`
endpoint, and **Retry configuration** only after an attempted
provisioning or validation failure.
For a pending rotation use **Key Rotation**, select the same endpoint, category and
old-key handling, then run it again. See [Key Rotation](../../platform/key-rotation.md)
for the durable phases and recovery rules.

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
