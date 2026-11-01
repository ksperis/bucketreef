import type { ExecutionContext } from "../api/executionContexts";

export function buildExecutionContext(
  id = "context-1",
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    kind: "account",
    id,
    display_name: `Context ${id}`,
    connection_scope: null,
    tags: [],
    endpoint_tags: [],
    manager_role: null,
    portal_role: null,
    rgw_account_id: null,
    endpoint_id: null,
    endpoint_name: "Default endpoint",
    endpoint_is_default: true,
    endpoint_provider: "ceph",
    endpoint_url: "https://s3.example.test",
    storage_endpoint_capabilities: {},
    destination_switching_allowed: false,
    execution_destinations: [],
    capabilities: {
      can_manage_iam: true,
      sts_capable: true,
      admin_api_capable: true,
    },
    ...overrides,
  };
}
