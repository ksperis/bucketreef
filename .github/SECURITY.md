# Security Policy

BucketReef takes security reports seriously. Please report suspected
vulnerabilities privately so they can be investigated and fixed before public
disclosure.

## Supported versions

BucketReef is currently in beta. Security fixes are provided for the latest
stable release.

| Version | Supported |
| --- | --- |
| Latest stable release | Yes |
| Earlier releases | No, unless explicitly stated in a security advisory |
| Development branches and unreleased builds | No |

Users should upgrade to the latest stable release before reporting an issue
that may already have been fixed.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Select **Report a vulnerability**.

Do not open a public GitHub issue, discussion, or pull request for an
undisclosed vulnerability.

Please include as much of the following information as possible:

- affected BucketReef version or commit;
- affected component and deployment method;
- vulnerability type and expected security impact;
- steps to reproduce or a minimal proof of concept;
- required privileges, configuration, and storage backend details;
- relevant logs or screenshots with credentials, tokens, keys, personal data,
  and other secrets removed;
- any known mitigations or workarounds.

Reports should contain only the sensitive information required to reproduce the
issue. Never include production credentials or private customer data.

## Scope

This policy covers vulnerabilities in BucketReef, its official deployment
artifacts, and BucketReef-specific interactions with supported S3-compatible
storage systems.

Vulnerabilities that are solely in Ceph, an S3-compatible storage provider,
the operating system, or another third-party dependency should be reported to
the corresponding upstream project. If BucketReef makes such an upstream issue
exploitable in a distinct way, report the BucketReef impact privately here as
well.

## Response and disclosure

The project aims to acknowledge a report within five business days. After
triage, the reporter will receive an assessment of the issue and, when
applicable, the expected remediation and disclosure process.

Please allow time for investigation, development, validation, and release of a
fix before publishing technical details. BucketReef follows coordinated
disclosure and will use a GitHub Security Advisory when an issue warrants one.
Eligible vulnerabilities may also receive a CVE through the GitHub advisory
process.

Once a fix is available, the project may publish an advisory describing the
affected versions, impact, remediation, and appropriate credit for the reporter.

## Security hardening documentation

Operational security guidance for BucketReef deployments is maintained in the
[Security documentation](https://docs.bucketreef.ksperis.com/admin/en/security/).
