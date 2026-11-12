# Deployment configuration

Use Admin to manage an installation interactively. To manage endpoints or selected
feature switches from Compose, Helm, or CI, apply a versioned deployment manifest.
All runtimes sharing the installation database use the applied values and locks.

## Local runtime surfaces

`DEPLOYMENT_PROFILE` selects the local profile. Its default surfaces are:

| Profile | Surfaces |
| --- | --- |
| `full` | `admin`, `ceph_admin`, `storage_ops`, `manager`, `portal`, `browser` |
| `admin` | `admin`, `ceph_admin`, `storage_ops` |
| `user` | `manager`, `portal`, `browser` |

Set `RUNTIME_SURFACES` to a JSON array, or set the Helm value `runtimeSurfaces`
to a YAML list. The full profile accepts any subset. The admin profile can
omit `ceph_admin`. The user profile has a fixed set of surfaces. Portal requires
both a runtime exposing `portal` and the shared `portal_enabled` setting.

## Apply a revision

Save the manifest as JSON. For example:

```json
{
  "schema_version": 1,
  "revision": 1,
  "features": {"portal_enabled": true},
  "storage_endpoints": [
    {
      "key": "primary-rgw",
      "name": "Primary RGW",
      "endpoint_url": "https://s3.example.com",
      "provider": "ceph",
      "service_identity_mode": "managed",
      "is_default": true,
      "features": {"admin": {"enabled": true}},
      "credentials": {
        "admin": {
          "access_key_file": "/deployment/credentials/admin-access-key",
          "secret_key_file": "/deployment/credentials/admin-secret-key"
        }
      }
    }
  ]
}
```

Use a positive, increasing revision for the installation. Omit a section or
feature key to retain its existing management policy. A Boolean value sets and
locks a feature. Use `null` to make a feature or the inventory editable while
preserving its current values. The supported switches are `manager_enabled`,
`openstack_enabled`, `ceph_admin_enabled`, `storage_ops_enabled`, `browser_enabled`,
`portal_enabled`, `cost_enabled`, and `endpoint_status_enabled`.

A `storage_endpoints` list must cover every registered endpoint. An empty list
locks an empty inventory. Give each entry a stable `key` containing 1–64 lowercase
letters, digits, underscores or hyphens, starting with a letter or digit.
An existing endpoint without a key is adopted by its current URL. Later
revisions identify it by key and can change its URL without changing its ID.
The first entry becomes the default when the list declares none explicitly.

Keep secret values in files readable by the provisioning process. Configure the
`admin`, `runtime`, `supervision`, and `ceph_admin` pairs under `credentials`
as required by the [Ceph endpoint configuration](../storage/backends/ceph-rgw.md).
Each pair references an absolute `access_key_file` and `secret_key_file`. Apply a
new revision when replacing credentials, including when file paths stay the same.

Use the same database and credential key ring as the application:

```bash
python -m app.scripts.configure_deployment apply --file /deployment/config/manifest.json
```

Omit `--file` to read inline JSON from `DEPLOYMENT_CONFIG`. The command prepares
the database schema and reports the applied revision. Exit status 2 means the
revision is applied and one or more endpoint identities still need attention.
Correct RGW connectivity or permissions and rerun the same revision to resume.
Invalid or stale revisions exit with status 1. To restore earlier values, submit
them as a newer revision.

To remove an endpoint or change its provider or identity mode, apply
`"storage_endpoints": null`, complete the operation in Admin, then apply a
new manifest covering the resulting inventory. Existing associations remain
subject to the Admin deletion safeguards.

## Compose and Helm

With Compose, mount a directory that contains the manifest and the referenced
credentials. Use the same Compose project and env file as the installation.
In a split, run it from the Admin project only.

```bash
docker compose --profile provision run --rm \
  --volume "$PWD/deployment-config:/deployment:ro" \
  configure-deployment --file /deployment/manifest.json
```

For Helm, supply an existing, preferably immutable, ConfigMap containing
`manifest.json` and, when needed, an existing Secret with the referenced files:

```yaml
deploymentConfiguration:
  enabled: true
  revision: "1"
  manifestConfigMap: bucketreef-config-1
  credentialSecret: bucketreef-rgw-1
```

The Job mounts the Secret at `/deployment/credentials` and runs from the Admin
or full release. Make PostgreSQL, the ConfigMap, Secrets and network access
available before creating the Job. The Job applies migrations before the
manifest. On first installation or a coordinated cutover, render and apply
`templates/deployment-configuration-job.yaml` in a pipeline stage, wait for Job
completion, then deploy the app releases with Job creation disabled. With GitOps
you can order these stages explicitly. For existing compatible backends, Helm can
also manage the Job as part of an upgrade. Use a new revision and ConfigMap for
each configuration change. A Helm rollback affects the workloads. Restoring the
database configuration requires a new manifest revision.

## Migrate from environment overrides

1. Record the effective features that you want to keep, the existing endpoint
   IDs, and the environment of each runtime. Back up the database and preserve
   the credential key ring together. Test the upgrade against an isolated copy.
2. Remove `FEATURE_*_ENABLED` and `ENV_STORAGE_ENDPOINTS` from your deployment
   files. For a split, keep the existing profile selectors and use
   `RUNTIME_SURFACES` only for explicit local exceptions. For a full deployment,
   translate any deliberately restricted surface set into `RUNTIME_SURFACES`.
   The old `FEATURE_ADMIN_ENABLED` maps to local surface exposure only.
3. Put any required global values in `features`. For example, use
   `"features": {"portal_enabled": true}` if the User backend served Portal.
   Use each feature's persisted field name in the manifest. Values forced by
   the old environment could differ from those stored in the database.
4. Convert the old endpoint array to `storage_endpoints`. The migration gives
   previously locked rows the key `endpoint-<id>`. Use that exact key for
   each of those rows. Give the remaining rows new keys and use their current
   URLs for adoption. Convert inline credential pairs to secret file references.
   Keep every existing endpoint in the first managed manifest.
5. Stop all old backends sharing the database. Apply revision 1 with the new
   image before starting the new Admin and User backends. If you want to take
   ownership through Admin, apply an explicit `"storage_endpoints": null`
   instead. The migration preserves the prior inventory lock even when the new
   runtime starts without any provisioning environment variables.
6. Verify the endpoint IDs, default endpoint, locks, and Portal access from
   both profiles. For rollback to binaries from before this change, use the
   verified pre-upgrade database and credential key ring.
