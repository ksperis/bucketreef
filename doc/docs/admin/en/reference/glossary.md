# Administration Glossary

| Term | Meaning in Administration |
|---|---|
| Storage endpoint | A configured S3-compatible backend and its capabilities. |
| S3 account | Platform-level storage account used for account administration, usage, quotas, and related workflows. |
| S3 connection | Credential-backed S3 context. Admin manages shared connections; private connections belong to individual users. |
| Ceph Admin | Administrative Ceph RGW workspace for cluster-level account, user, bucket, and metrics workflows. |
| Storage Ops | Administrative workspace for operations across authorized storage contexts. |
| Admin Ops credentials | Dedicated endpoint credentials used for explicitly authorized administrative Ceph/RGW workflows. |
| Effective access | The access resulting from user, group, account, context, and feature assignments after BucketReef combines them. |
| Feature setting | Platform configuration that enables or constrains a workspace or feature. |
| Endpoint capability | A storage feature supported or configured for an endpoint, such as IAM, SNS, metrics, usage, or versioning. |
| Application audit | BucketReef control-plane, security, configuration, and workflow-control events. Object data-plane requests are excluded. |
| S3 access logs | Provider-side records for object requests when that backend and project have access logging enabled. |
| UI Tags | BucketReef metadata for organizing administrative bucket sets. They do not modify S3 object or bucket tags. |

## Related pages

- [Configuration](../configuration/index.md)
- [Ceph Admin](../storage/ceph-admin/index.md)
- [Storage Ops](../storage/storage-ops/index.md)
- [Troubleshooting](../help/troubleshooting.md)
