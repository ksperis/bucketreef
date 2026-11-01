import type { AccessKey } from "../api/managerIamUsers";

export function buildIamAccessKey(
  accessKeyId: string,
  overrides: Partial<AccessKey> = {},
): AccessKey {
  return {
    access_key_id: accessKeyId,
    status: "Active",
    created_at: null,
    secret_access_key: null,
    is_private_access_managed: false,
    managed_connection_id: null,
    name: null,
    notes: null,
    expires_at: null,
    expiration_state: null,
    expiration_enforced_at: null,
    expiration_last_attempt_at: null,
    expiration_last_error: null,
    ...overrides,
  };
}
