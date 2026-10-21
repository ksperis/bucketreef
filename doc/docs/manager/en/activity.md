# Activity history

Manager Activity history shows the control-plane and configuration actions recorded for the selected execution context.

Use it to answer questions such as who changed a bucket configuration, created or removed an IAM resource, or triggered another Manager administration action. The page shows the time, actor, readable action label, technical audit action, status, and target. You can search by actor, action, or target, filter by status, refresh the current results, and load older entries.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/manager-activity.light.png" alt="Manager Activity history with actors, actions, status and targets for the selected context" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/manager-activity.dark.png" alt="Manager Activity history with actors, actions, status and targets for the selected context" loading="lazy">
</div>

Activity history is available for durable Manager contexts backed by an **RGW Account**, an **RGW User**, or an **S3 Connection assigned through Admin**. It is enabled by default at platform level, and an administrator can change the platform policy or override it for an individual supported resource. Private S3 Connections do not expose this page.

This history is deliberately narrower than an S3 access log. It does **not** show object reads, object downloads, or other S3 data-plane access. It also does not expose audit metadata such as request identifiers, source IP addresses, user agents, or secret-bearing metadata.

If **Activity** is not visible in the Manager navigation, verify that a supported execution context is selected and that the feature is enabled for that resource. Platform administrators can review the Manager feature policy and the resource-level override from Admin.
