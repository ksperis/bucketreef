# Start Here

Use the Administration guide when you deploy BucketReef, configure the platform,
or operate its storage integrations.

## Choose your starting point

| Your responsibility | Start with |
|---|---|
| Evaluate or install BucketReef | [Local quickstart](../install/quickstart.md), then choose [Docker Compose](../install/docker-compose.md) or [Helm](../install/helm.md). |
| Take over an existing deployment | [Sysadmin onboarding](sysadmin-onboarding.md). |
| Configure users, endpoints, accounts, shared connections, settings, audit, or billing | [Admin workspace](../platform/index.md). |
| Operate Ceph RGW at cluster scope | [Ceph Admin](../storage/ceph-admin/index.md). |
| Run bucket operations across authorized contexts | [Storage Ops](../storage/storage-ops/index.md). |
| Prepare a service for application or end-user teams | [Storage admin runbook](storage-admin-runbook.md). |
| Diagnose a production problem | [Troubleshooting](../help/troubleshooting.md) and [Observability](../operations/observability.md). |

## First administration pass

1. Verify the deployment, persistent services, secrets, and public URL.
2. Configure at least one storage endpoint and confirm its health.
3. Configure UI users/groups and the storage contexts they should access.
4. Enable only the workspaces and features the service needs.
5. Verify scheduler jobs, metrics, audit, backup, and recovery.
6. Run a small end-to-end handover scenario with the target user role before
   announcing the service.

Administration owns platform configuration and operational storage work. Bucket
and IAM administration inside a user's assigned S3 context is documented in the
separate Manager guide; end-user Storage Space workflows are documented in the
Portal guide.

## Related pages

- [Common administration tasks](common-tasks.md)
- [Administration use cases](use-cases.md)
- [Feature availability](../help/feature-availability.md)
- [Production readiness](../operations/production-readiness.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/start-here.light.png" alt="BucketReef workspace selector for administrative work" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/start-here.dark.png" alt="BucketReef workspace selector for administrative work" loading="lazy">
</div>
