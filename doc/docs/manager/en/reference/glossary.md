# Manager Glossary

| Term | Meaning in Manager |
|---|---|
| Execution context | The account, S3 user, or eligible S3 connection whose credentials execute Manager actions. |
| S3 account | Account-scoped storage context used for bucket and IAM administration. |
| S3 user | Ceph RGW user context that may expose a Manager subset when explicitly assigned. |
| S3 connection | Credential-backed context for a supported S3 endpoint. |
| Account administrator | The Manager account role stored as `account_administrator`. It is independent from Portal roles. |
| IAM | Storage-side identities, groups, roles, and policies exposed by an endpoint that supports IAM. |
| Access key | Access-key ID plus secret used by an S3/IAM principal. The secret is shown only by an authorized creation or delivery flow. |
| Topic | SNS topic used by supported S3 notification workflows. |
| Manager tool | Optional compare, integrity, purge, or migration workflow with its own enablement and access rules. |
| Embedded Browser | Object Browser rendered inside Manager and bound to the active Manager context when data access is allowed. |
| `AccessDenied` | Storage-side authorization failure for the active execution identity. |

A `portal_manager` is a Portal project role. It does not grant Manager access.

## Related pages

- [Manager guide](../index.md)
- [IAM](../iam/index.md)
- [Feature availability](../help/feature-availability.md)
