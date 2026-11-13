import { describe, expect, it } from "vitest";
import type { ManagerContext } from "../api/managerContext";
import { currentUser, type DemoRequest } from "./http";
import { readModels } from "./readModels";
import { createSeed, settings } from "./state";

async function managerContext(
  options: {
    state?: ReturnType<typeof createSeed>;
    includeLimits?: boolean;
    contextId?: string;
  } = {},
): Promise<ManagerContext> {
  const state = options.state ?? createSeed();
  const user = currentUser(state, "manager");
  const account = state.accounts.find(candidate =>
    candidate.user_links.some(link => link.user_id === user.id && link.manager_role === "account_administrator")
  );
  if (!account) throw new Error("Demo manager account fixture is missing");
  const url = new URL("https://demo.test/api/manager/context");
  url.searchParams.set("context_id", options.contextId ?? String(account.id));
  if (options.includeLimits) url.searchParams.set("include_limits", "true");
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
    const context = await managerContext({ includeLimits: true });

    expect(context.quota_max_size_gb).not.toBeNull();
    expect(context.max_buckets).toBe(100);
    expect(context.max_users).toBe(100);
    expect(context.max_roles).toBe(100);
    expect(context.max_groups).toBe(100);
  });

  it("derives Account Manager Browser availability from explicit and automatic access", async () => {
    const state = createSeed();
    const account = state.accounts[0];
    const previousPolicy = settings.manager.feature_policies.manager_browser_data_access;
    for (const link of account.user_links) link.allow_manager_browser_data_access = false;
    for (const link of account.group_links) link.allow_manager_browser_data_access = false;

    try {
      settings.manager.feature_policies.manager_browser_data_access = "disabled";
      expect((await managerContext({ state, contextId: String(account.id) })).manager_browser_enabled)
        .toBe(false);

      settings.manager.feature_policies.manager_browser_data_access = "targeted";
      account.allow_manager_browser_data_access_for_all_admins = true;
      expect((await managerContext({ state, contextId: String(account.id) })).manager_browser_enabled)
        .toBe(true);
    } finally {
      settings.manager.feature_policies.manager_browser_data_access = previousPolicy;
    }
  });

  it("derives RGW User Manager Browser availability without exposing it in the Browser root workspace", async () => {
    const state = createSeed();
    const user = currentUser(state, "manager");
    const account = state.accounts[0];
    const rgwUserId = account.id * 100;
    const previousPolicy = settings.manager.feature_policies.manager_browser_data_access;
    user.s3_user_links = [{ s3_user_id: rgwUserId, allow_manager_browser_data_access: false }];
    state.iam[account.id].users[0].allow_manager_browser_data_access_for_all_admins = true;

    try {
      settings.manager.feature_policies.manager_browser_data_access = "targeted";
      const context = await managerContext({ state, contextId: `s3u-${rgwUserId}` });
      expect(context).toMatchObject({
        access_mode: "s3_user",
        context_kind: "s3_user",
        manager_browser_enabled: true,
      });

      const url = new URL("https://demo.test/api/me/workspace-access");
      const response = readModels({
        state,
        url,
        path: "/me/workspace-access",
        method: "GET",
        body: {},
        request: new Request(url),
        persona: "manager",
        user,
      });
      expect(response).toBeDefined();
      expect((await response!.json()).browser).toEqual({ available: false, context_count: 0 });
    } finally {
      settings.manager.feature_policies.manager_browser_data_access = previousPolicy;
    }
  });
});
