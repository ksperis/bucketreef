# OpenStack project connections

Connect to Keystone v3 independently of the BucketReef login method. Keystone
may use LDAP, SQL identities or federation. Each person selects a project and
uses an existing personal EC2 credential against a registered S3 endpoint.
Keystone and the storage service retain authorization authority.

## Configure a cloud

As a Superadmin, open **Settings > OpenStack > Add cloud**. Enter the final HTTPS
Keystone URL ending in `/v3` and select registered S3 endpoints. The Swift service
catalog is not used to discover S3 URLs. Enable password authentication, primary
user-token authentication, or both. The optional default domain is a user hint.
Assign UI users/groups, or explicitly allow all authorized UI users, then enable
and save the cloud. New clouds are disabled and restricted by default.

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
Changing an associated endpoint's URL, TLS, signing or feature configuration also
invalidates the cloud sessions, requiring explicit reconnection.
The S3 provider remains independent of Keystone. No remote resource is provisioned.

## Connect a project

Open **Profile > OpenStack**, or `/profile?tab=openstack` if no storage workspace
is available yet. Choose a cloud, authenticate, select a project and endpoint,
then open Browser or Manager. Multiple clouds and identities are supported.

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
the selected credentials. RGW administrative metrics/quotas, managed personal
access provisioning, STS and credential export are unavailable. No Portal
project or RGW Account is created.

Transfers follow the existing Browser policy. Presigned URLs are bounded by the
current access deadline; already issued URLs remain usable until their own
expiration even after logout.

## Reproducible reserved-environment validation

Use Keystone with an SQL identity backend and a dedicated RGW endpoint configured
for Keystone S3 authentication. LDAP is unnecessary. Prepare two projects and two
distinct users through the normal OpenStack process, with one key in one project
and two keys in the other.

1. Assign the test cloud to one UI user. Connect separately using a password and
   a primary user token; select both projects and verify explicit key selection.
2. In a reserved project, open Browser/Manager, create a uniquely named test
   bucket, upload/read/delete a fixture, then remove the empty bucket.
3. Verify isolation from another user and a second UI session. Test direct and
   group admission, withdrawal, and an endpoint removed from the cloud.
4. Revoke the initiating session during a test long operation and verify that it
   stops. Reauthenticate and explicitly resume with the same identity/project.
5. Remove a Keystone role and verify denial after revalidation. Stop Keystone and
   verify failure after validation expires, with no administrative fallback.
6. Check that expiration offers OpenStack reconnection without logging out of
   BucketReef, and that API responses/logs contain no secrets.

Mocked backend tests and browser simulations do not prove live Keystone/RGW
policy compatibility. Record provider versions and results for this scenario.
