# OpenStack projects

An administrator can configure OpenStack clouds that provide S3 access through
your own project credentials. Your BucketReef login method can be independent.

1. Open **Profile > OpenStack**, or `/profile?tab=openstack` if no workspace is
   available.
2. Choose a cloud and authenticate using your OpenStack credentials or a primary
   user token. The user domain belongs to OpenStack.
3. Select a project, S3 endpoint and EC2 key when several keys are available.
4. Choose **Open Browser**, or **Open Manager** when enabled. The context selector
   distinguishes the cloud, identity, project and endpoint.

If no key exists, obtain one through OpenStack and refresh. A visible Keystone
project does not guarantee bucket access: the storage service applies the actual
permissions.

Access is limited to this UI session and the OpenStack authentication validity.
Reconnect after expiration. Disconnect erases local session secrets; forgetting
also removes local references. Neither action deletes remote keys or buckets.

Transfers follow the Browser policy. STS and credential export are unavailable.
Already issued presigned URLs can remain usable until their own expiration.
