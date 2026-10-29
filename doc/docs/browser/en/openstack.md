# OpenStack projects

An administrator can configure OpenStack clouds that provide S3 access through
your own project credentials. Your BucketReef login method can be independent.
The experimental OpenStack connector must also be enabled in General settings.
Cloud admission is granted through your UI user or UI group associations. An
administrator may also grant a cloud to the built-in **All users** group, whose
membership automatically includes every current and future active UI user.

1. Open **Profile > OpenStack**, or `/profile?tab=openstack` if no workspace is
   available.
2. Choose a cloud and authenticate using your OpenStack credentials or a primary
   user token. The user domain belongs to OpenStack.
3. Select the project directly in the Browser or Manager context selector.
   BucketReef discovers S3 regions from the scoped Keystone service catalog and
   asks for a region or EC2 key only when several choices exist.
4. The active OpenStack region appears beside the context selector. When the
   project exposes several regions, use that control to switch region explicitly.
   The context details show the cloud, identity, project, region and S3 endpoint.

An administrator can restrict a cloud to S3 endpoints already managed by
BucketReef. Regions outside that policy remain listed so the Keystone catalog is
still visible, but they are greyed out and cannot be selected. A region whose S3
URL matches a managed BucketReef endpoint automatically inherits that endpoint's
metadata and supported BucketReef capabilities.

If no key exists, obtain one through OpenStack and refresh. A visible Keystone
project does not guarantee bucket access: the storage service applies the actual
permissions.

Access is limited to this UI session and the OpenStack authentication validity.
Reconnect after expiration. Disconnect erases local session secrets; forgetting
also removes local references. Neither action deletes remote keys or buckets.
If Keystone changes the selected S3 catalog target, BucketReef asks you to
reactivate the project instead of silently following the changed endpoint.

Transfers follow the Browser policy. STS and credential export are unavailable.
Already issued presigned URLs can remain usable until their own expiration.
