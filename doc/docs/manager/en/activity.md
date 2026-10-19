# Activity history

Manager Activity history shows the control-plane and configuration actions recorded for the selected execution context.

Use it to answer questions such as who changed a bucket configuration, created or removed an IAM resource, or triggered another Manager administration action. The page shows the time, actor, readable action label, technical audit action, status, and target. You can search by actor, action, or target, filter by status, refresh the current results, and load older entries.

Activity history is available for durable Manager contexts backed by an **RGW Account**, an **RGW User**, or an **S3 Connection assigned through Admin**. It is enabled by default at platform level, and an administrator can change the platform policy or override it for an individual supported resource. Private S3 Connections do not expose this page.

This history is deliberately narrower than an S3 access log. It does **not** show object reads, object downloads, or other S3 data-plane access. It also does not expose audit metadata such as request identifiers, source IP addresses, user agents, or secret-bearing metadata.

If **Activity** is not visible in the Manager navigation, verify that a supported execution context is selected and that the feature is enabled for that resource. Platform administrators can review the Manager feature policy and the resource-level override from Admin.
