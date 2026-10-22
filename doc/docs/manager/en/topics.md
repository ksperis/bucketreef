# Feature: SNS Topics

## When to use

Use this guide to manage SNS topic resources from Manager.

## Prerequisites

- Access to `/manager/topics`.
- Endpoint SNS capability enabled.

## Before you start

Confirm that the selected endpoint supports SNS. Topics and bucket notification bindings are endpoint-specific and should be reviewed in the same Manager context.

## Steps

1. Open **Manager > SNS Topics**.
2. Create a topic.
3. Select a topic to open its resource workspace.
4. Use **Configuration** to inspect or edit delivery attributes and **Policy**
   to review or edit the SNS access policy. Each tab has its own URL, so a
   refresh or direct link returns to the same part of the topic workflow.
5. Delete unused topics.

The topic list exposes the topic ARN and the direct entry points for attributes,
policy, and deletion before you open a resource workspace.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/feature-topics.light.png" alt="Manager SNS Topics list with ARNs and topic actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/feature-topics.dark.png" alt="Manager SNS Topics list with ARNs and topic actions" loading="lazy">
</div>

## Expected result

SNS topics are managed within the selected manager context.
For Ceph RGW endpoints, duplicate raw topic entries that share the same topic
ARN are folded into one topic row.

## You are done when

The topic list, attributes, and policy match the intended event workflow.

## If you do not see this action

Check endpoint capability `sns`, Manager access, and whether bucket notification configuration is supported for the target context.

## Limits / feature flags

!!! note
    SNS menu is shown only when endpoint capability `sns` is enabled.

## Related pages

- [Workspace: Manager](index.md)
