# OpenStack project connections

Connect to Keystone v3 independently of the BucketReef login method. Keystone
may use LDAP, SQL identities or federation. Each person selects a project and
uses an existing personal EC2 credential against an S3 target discovered from
that project's scoped Keystone service catalog.
Keystone and the storage service retain authorization authority.

## Configure a cloud

As a Superadmin, open **Settings > OpenStack > Add cloud**. Enter the final HTTPS
Keystone URL ending in `/v3`. S3 regions and endpoint URLs are discovered
automatically from each project's scoped Keystone service catalog. When a
discovered S3 URL exactly matches a BucketReef Storage Endpoint URL, the
OpenStack context is associated with that managed endpoint and reuses its
metadata and supported endpoint capabilities. BucketReef prefers an `s3`
service and its `public` endpoint for each region. An `object-store` service is
accepted only when its URL is a direct S3-compatible target rather than a Swift
`/v1/AUTH_*` path. Enable password authentication, primary user-token
authentication, or both. The optional default domain is a user hint.
Assign UI users/groups, or explicitly allow all authorized UI users, then enable
and save the cloud. By default, every S3 endpoint advertised by Keystone is
allowed. Enable **Only allow BucketReef-managed S3 endpoints** when the cloud
must be limited to URLs already declared as BucketReef Storage Endpoints. In
that mode, unmanaged Keystone regions remain visible to users but cannot be
selected, and the backend rejects attempts to activate them. New clouds remain
disabled and restricted to explicitly assigned BucketReef users by default.

Configure the backend's outbound policy first:

```dotenv
OPENSTACK_ALLOWED_HOSTS=["identity.example.org"]
# Enable only for explicitly trusted private-network Keystone deployments:
OPENSTACK_ALLOW_PRIVATE_TARGETS=false
# Optional server-mounted private CA bundle; verification remains enabled:
# OPENSTACK_CA_FILE=/etc/bucketreef/certificates/cloud-ca.pem
```

Requests use HTTPS, bounded timeouts and response sizes, and reject redirects.
Saving cloud configuration or assignments invalidates its active connections.
S3 endpoint URLs coming from an authenticated, project-scoped Keystone catalog
are treated as administrator-controlled configuration. They must still be HTTPS
URLs without embedded credentials, query parameters or fragments, but they do
not use BucketReef's user-supplied endpoint allow-list or private-network block.
If the catalog changes the selected S3 target, region or URL, BucketReef refuses
to silently redirect an existing execution context and requires explicit
reactivation. Managed-endpoint association is resolved from the current URL,
so adding a matching Storage Endpoint later enriches an existing OpenStack
context without changing its Keystone target or EC2 credentials. No remote
resource is provisioned.

## Connect a project

Open **Profile > OpenStack**, or `/profile?tab=openstack` if no storage workspace
is available yet. Choose a cloud and authenticate. The available projects then
appear directly in the Manager and Browser context selector. Selecting a project
discovers its S3 regions and existing EC2 credentials. If several regions or
credentials are available, choose them explicitly. The active OpenStack region
is visible in the workspace topbar and can be changed there. Multiple clouds and
identities are supported.

BucketReef never stores the supplied password or automatically forwards its own
LDAP login credentials. User-token authentication requires a primary user token
authorized to discover projects and read its owner's EC2 credentials. Application
credential, trust and EC2-derived tokens are unsupported. Interactive WebSSO and
MFA receipt completion are outside this version; an appropriate externally
obtained user token may be supplied instead.

Select a key explicitly when several exist. If no key exists, provision one
through OpenStack and refresh the project selection. BucketReef never creates,
rotates or deletes remote EC2 keys.

## Session and permissions

Tokens and EC2 secrets are encrypted and isolated by BucketReef UI session.
Logout, revocation, expiration and OpenStack disconnect erase them. Forgetting
a connection also removes its local project references and sessions, preserving
remote resources. A fresh UI session requires OpenStack authentication again.

Cloud access expires no later than the original Keystone authentication or UI
session. Local grants are checked on every request. Project and key authorization
is revalidated at most every 60 seconds; unavailable Keystone fails closed after
validation expires. Long operations retain the initiating session reference and
stop when access is no longer valid.

Manager UI rights still apply. IAM requires a successful read-only probe with
the selected credentials. A managed-endpoint association exposes endpoint
metadata and S3-side capabilities such as BucketReef usage collection without
substituting endpoint service identities for the user's OpenStack credentials.
RGW account/user administrative metrics and quotas still require a resolvable
RGW principal and are not inferred from the OpenStack project alone. Managed
personal access provisioning, STS and credential export are unavailable. No
Portal project or RGW Account is created.

Transfers follow the existing Browser policy. Presigned URLs are bounded by the
current access deadline; already issued URLs remain usable until their own
expiration even after logout.

## Reproducible reserved-environment validation

Use Keystone with an SQL identity backend and a dedicated RGW endpoint configured
for Keystone S3 authentication. LDAP is unnecessary. Prepare two projects and two
distinct users through the normal OpenStack process, with one key in one project
and two keys in the other.

1. Assign the test cloud to one UI user. Connect separately using a password and
   a primary user token; select both projects and verify catalog region discovery
   plus explicit key selection.
2. In a reserved project, open Browser/Manager, create a uniquely named test
   bucket, upload/read/delete a fixture, then remove the empty bucket.
3. Verify isolation from another user and a second UI session. Test direct and
   group admission and withdrawal, then change/remove a catalog S3 target and
   verify that the existing context requires reactivation.
4. Revoke the initiating session during a test long operation and verify that it
   stops. Reauthenticate and explicitly resume with the same identity/project.
5. Remove a Keystone role and verify denial after revalidation. Stop Keystone and
   verify failure after validation expires, with no administrative fallback.
6. Check that expiration offers OpenStack reconnection without logging out of
   BucketReef, and that API responses/logs contain no secrets.

Mocked backend tests and browser simulations do not prove live Keystone/RGW
policy compatibility. Record provider versions and results for this scenario.
