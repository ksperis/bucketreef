import { describe, expect, it } from "vitest";
import type { ManagerContext } from "../api/managerContext";
import { currentUser, type DemoRequest } from "./http";
import { readModels } from "./readModels";
import { createSeed } from "./state";

async function managerContext(includeLimits = false): Promise<ManagerContext> {
  const state = createSeed();
  const user = currentUser(state, "manager");
  const account = state.accounts.find(candidate =>
    candidate.user_links.some(link => link.user_id === user.id && link.manager_role === "account_administrator")
  );
  if (!account) throw new Error("Demo manager account fixture is missing");
  const url = new URL("https://demo.test/api/manager/context");
  url.searchParams.set("context_id", String(account.id));
  if (includeLimits) url.searchParams.set("include_limits", "true");
  const request: DemoRequest = {
    state,
    url,
    path: "/manager/context",
    method: "GET",
    body: {},
    request: new Request(url),
    persona: "manager",
    user,
  };
  const response = readModels(request);
  expect(response).toBeDefined();
  return response!.json();
}

describe("demo manager context", () => {
  it("serves the complete context while keeping limits deferred by default", async () => {
    const context = await managerContext();

    expect(context).toMatchObject({
      feature_states: {},
      naming_validation_profile: "ceph",
      access_mode: "admin",
      context_kind: "account",
      manager_stats_message: null,
      manager_browser_message: null,
      manager_access_key_metadata_enabled: false,
      manager_access_key_expiration_enabled: false,
      quota_max_size_gb: null,
      quota_max_objects: null,
      max_buckets: null,
      max_users: null,
      max_roles: null,
      max_groups: null,
    });
  });

  it("loads limits only when explicitly requested", async () => {
    const context = await managerContext(true);

    expect(context.quota_max_size_gb).not.toBeNull();
    expect(context.max_buckets).toBe(100);
    expect(context.max_users).toBe(100);
    expect(context.max_roles).toBe(100);
    expect(context.max_groups).toBe(100);
  });
});
