import { afterEach, describe, expect, it } from "vitest";
import {
  demoS3UserResources,
  resolveDemoAccountManagerBrowserAccess,
  resolveDemoS3UserManagerBrowserAccess,
} from "./managerBrowserAccess";
import { createSeed, settings } from "./state";

const originalPolicy = settings.manager.feature_policies.manager_browser_data_access;

afterEach(() => {
  settings.manager.feature_policies.manager_browser_data_access = originalPolicy;
});

describe("demo Manager Browser access", () => {
  it("keeps explicit Account grants additive when the automatic policy is disabled", () => {
    const state = createSeed();
    const user = state.users[1];
    const account = state.accounts[0];
    settings.manager.feature_policies.manager_browser_data_access = "disabled";

    const access = resolveDemoAccountManagerBrowserAccess(state, account, user);

    expect(access.allowed).toBe(true);
    expect(access.sources.map(source => source.kind)).toEqual(["direct", "group"]);
  });

  it("resolves targeted and default-on Account automatic access with resource overrides", () => {
    const state = createSeed();
    const user = state.users[1];
    const account = state.accounts[0];
    for (const link of account.user_links) link.allow_manager_browser_data_access = false;
    for (const link of account.group_links) link.allow_manager_browser_data_access = false;

    settings.manager.feature_policies.manager_browser_data_access = "targeted";
    expect(resolveDemoAccountManagerBrowserAccess(state, account, user)).toEqual({
      allowed: false,
      sources: [],
    });

    account.allow_manager_browser_data_access_for_all_admins = true;
    expect(resolveDemoAccountManagerBrowserAccess(state, account, user).sources.map(source => source.kind))
      .toEqual(["resource"]);

    settings.manager.feature_policies.manager_browser_data_access = "default_on";
    account.allow_manager_browser_data_access_for_all_admins = null;
    expect(resolveDemoAccountManagerBrowserAccess(state, account, user).sources.map(source => source.kind))
      .toEqual(["platform"]);

    account.allow_manager_browser_data_access_for_all_admins = false;
    expect(resolveDemoAccountManagerBrowserAccess(state, account, user)).toEqual({
      allowed: false,
      sources: [],
    });
  });

  it("applies the same additive policy to RGW User grants", () => {
    const state = createSeed();
    const user = state.users[1];
    const account = state.accounts[0];
    const rgwUserId = account.id * 100;
    user.s3_user_links = [{ s3_user_id: rgwUserId, allow_manager_browser_data_access: true }];

    settings.manager.feature_policies.manager_browser_data_access = "disabled";
    let rgwUser = demoS3UserResources(state).find(candidate => candidate.id === rgwUserId)!;
    expect(resolveDemoS3UserManagerBrowserAccess(state, rgwUser, user).sources.map(source => source.kind))
      .toEqual(["direct"]);

    user.s3_user_links[0].allow_manager_browser_data_access = false;
    settings.manager.feature_policies.manager_browser_data_access = "targeted";
    state.iam[account.id].users[0].allow_manager_browser_data_access_for_all_admins = true;
    rgwUser = demoS3UserResources(state).find(candidate => candidate.id === rgwUserId)!;
    expect(resolveDemoS3UserManagerBrowserAccess(state, rgwUser, user).sources.map(source => source.kind))
      .toEqual(["resource"]);

    settings.manager.feature_policies.manager_browser_data_access = "default_on";
    state.iam[account.id].users[0].allow_manager_browser_data_access_for_all_admins = null;
    rgwUser = demoS3UserResources(state).find(candidate => candidate.id === rgwUserId)!;
    expect(resolveDemoS3UserManagerBrowserAccess(state, rgwUser, user).sources.map(source => source.kind))
      .toEqual(["platform"]);

    state.iam[account.id].users[0].allow_manager_browser_data_access_for_all_admins = false;
    user.s3_user_links[0].allow_manager_browser_data_access = true;
    rgwUser = demoS3UserResources(state).find(candidate => candidate.id === rgwUserId)!;
    expect(resolveDemoS3UserManagerBrowserAccess(state, rgwUser, user).sources.map(source => source.kind))
      .toEqual(["direct"]);
  });
});
