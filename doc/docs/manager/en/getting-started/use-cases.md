# Manager Use Cases

Manager is for S3 and IAM administration inside one selected execution context.

## Application bucket administration

Create the application's bucket, configure versioning, lifecycle, policy, CORS,
notifications, and other supported bucket settings, then inspect logical usage
for that same context.

## IAM administration

Create or manage IAM users, groups, roles, and policies when the endpoint
supports them. Use the access-key workflow only for principal types and
contexts explicitly enabled for key management.

## Event configuration

Manage SNS topics and bucket notifications when the selected endpoint exposes
those capabilities.

## Data operations inside Manager

Use Manager's embedded Browser when data access has been explicitly enabled for
the active context. It keeps the Manager execution context rather than switching
to a separate standalone Browser identity.

## Storage tools

Use bucket compare, integrity, purge, and migration when those Manager tools are
enabled for you. Destructive and long-running tools keep their own confirmation,
progress, and revalidation rules.

A Portal Manager is a Portal project role and is not a Manager use case unless
the same person separately has Manager access.

## Related pages

- [Common tasks](common-tasks.md)
- [Feature availability](../help/feature-availability.md)
- [Safe operations](../reference/safe-operations.md)
