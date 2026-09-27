/** Demo-only coverage. Each addition needs a handler and a real-build browser scenario. */
export const coverage = [
  { id: "governance", mode: "interactive", scope: "Admin users, groups, accounts, endpoints, manual connections and associations", limitation: "Local identities and fictitious credentials only", scenario: "governance" },
  { id: "bucket-config", mode: "interactive", scope: "Manager and Ceph bucket configuration and quotas", limitation: "Configuration is stored; lifecycle, encryption, replication and IAM evaluation do not execute", scenario: "cross-workspace" },
  { id: "iam", mode: "interactive", scope: "IAM users, groups, roles, policies and sample keys", limitation: "Keys cannot authenticate to a service", scenario: "iam" },
  { id: "portal", mode: "interactive", scope: "Spaces, collaborators, internal shares and requests", limitation: "All people and resources belong to this browser", scenario: "portal-approval" },
  { id: "objects", mode: "interactive", scope: "Folders, search, upload, preview, download, delete, metadata, tags and single Portal version restore", limitation: "Seeded dataset sizes are simulated; downloads contain sample payloads. Imports: 20 MiB per file, 100 MiB total including versions", scenario: "files" },
  { id: "snapshots", mode: "readonly", scope: "Health, metrics, history, billing, audit and comparison example", limitation: "Dated snapshots; no traffic generator or remediation", scenario: "workspaces" },
  { id: "settings", mode: "readonly", scope: "Global settings, authentication and integrations", limitation: "Excluded settings cannot be enabled", scenario: "restrictions" },
  { id: "operations", mode: "disabled", scope: "Migrations, purge, integrity and index repair", limitation: "Routes and requests are blocked", scenario: "restrictions" },
  { id: "transfers", mode: "disabled", scope: "Multipart, resumable and cross-connection transfers; bulk and point-in-time restore; history cleanup", limitation: "No long-running task engine", scenario: "restrictions" },
  { id: "external", mode: "disabled", scope: "MFA, SSO, LDAP, recovery, managed private provisioning, external sends, webhooks, SNS and live public links", limitation: "No external business connection", scenario: "restrictions" },
] as const;

export const disabledFlags = {
  bucket_migration_enabled: false,
  bucket_purge_enabled: false,
  bucket_integrity_check_enabled: false,
  managed_private_connection_provisioning_enabled: false,
} as const;

export const disabledRequest = /\/(?:migrations|multipart|integrity-check|index-check|purge|key-rotation|managed-private-access|webauthn|recovery|oidc|ldap)(?:\/|$)|\/versions\/cleanup|\/trash\/restore-prefix|\/restore-at|\/compare\/action|\/usage-stats\/(?:run|calculate|scan|recalculate)/;
export const disabledRoute = /\/(?:migrations|bucket-migration|bucket-integrity|bucket-purge|index-check|key-rotation|storage-ops)(?:\/|$)/;
export const readonlyRequest = /^\/(?:settings(?:\/|$)|admin\/(?:settings|auth|integrations|webhooks|billing|health|audit)|auth\/settings)|\/public-links(?:\/|$)|\/topics(?:\/|$)/;
