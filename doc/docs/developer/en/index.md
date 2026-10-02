# Development and Contribution Guide

Use this guide when you develop BucketReef, contribute changes, understand its
architecture, maintain CI/releases, or work on project documentation.

## Scope

- Architecture, principles, identity/execution model, and workspace boundaries.
- Backend, frontend, database, API, and implementation reference.
- Local development, testing, fixtures, and authenticated UI workflows.
- Contribution and AI-assistant guardrails.
- CI/CD, release engineering, and static demo maintenance.
- Product-design and frontend implementation conventions.
- Documentation architecture and maintenance.

This guide is about developing **BucketReef itself**. An application developer
who only needs to provision and use S3 storage should start in the
[Manager guide](/manager/en/) instead.

## Recommended reading order

1. [Architecture overview](architecture/index.md)
2. [Principles](architecture/principles.md)
3. [AI assistant guidelines](contributing/ai-assistant-guidelines.md)
4. [Identity and execution model](architecture/identity-and-execution.md)
5. [Workspace surface separation](architecture/workspace-surfaces.md)
6. [Product design guidelines](frontend/product-design.md)
7. [Local development](contributing/local-development.md)
8. [Authenticated UI access for AI agents](testing/authenticated-ui-ai-agents.md)
9. [First contribution](contributing/first-contribution.md)
10. [UI theme guidelines](frontend/ui-theme.md)
11. [Docs maintenance](documentation/maintenance.md)

The [static interactive demo](testing/static-demo.md) documents the local simulation,
coverage boundaries, browser tests and release-gated publication.
