import { describe, expect, it } from "vitest";
import { governance } from "./governance";
import { currentUser, type DemoRequest } from "./http";
import { createSeed } from "./state";
import { demoUserView } from "./userProjection";

function request(state: ReturnType<typeof createSeed>, path: string): DemoRequest {
  return {
    state,
    path,
    method: "GET",
    body: {},
    url: new URL(`https://demo.test/api${path}`),
    request: new Request("https://demo.test"),
    persona: "admin",
    user: currentUser(state, "admin"),
  };
}

describe("demo user projection", () => {
  it("projects inherited Manager rights and account provenance from UI groups", () => {
    const state = createSeed();
    const user = state.users[7];
    const designGroup = state.groups.find(group => group.name === "Design");
    expect(designGroup).toBeDefined();
    designGroup!.manager_tool_access = {
      bucket_compare: true,
      bucket_integrity_check: false,
      bucket_migration: false,
      bucket_purge: false,
      feature_rules: false,
    };

    const projected = demoUserView(state, user);

    expect(projected.effective_access.manager_tool_access.bucket_compare).toBe(true);
    expect(projected.effective_access.group_manager_tool_access?.bucket_compare).toBe(true);
    const inheritedAccount = projected.effective_access.account_links.find(
      link => link.account_id === state.accounts[0].id,
    );
    expect(inheritedAccount).toEqual(expect.objectContaining({
      manager_role: "account_administrator",
      portal_role: null,
    }));
    expect(inheritedAccount?.provenance.groups).toEqual([
      expect.objectContaining({
        group_id: designGroup?.id,
        group_name: "Design",
        determines_effective_manager_role: true,
      }),
    ]);
  });

  it("serves canonical user DTOs while keeping the minimal endpoint summarized", async () => {
    const state = createSeed();
    const listResponse = governance(request(state, "/admin/users"));
    expect(listResponse).toBeDefined();
    const list = await listResponse!.json();
    expect(list.items[0].effective_access).toEqual(expect.objectContaining({
      account_links: expect.any(Array),
      manager_tool_access: expect.any(Object),
    }));

    const detailResponse = governance(request(state, `/admin/users/${state.users[0].id}`));
    expect(detailResponse).toBeDefined();
    expect(await detailResponse!.json()).toHaveProperty("effective_access");

    const minimalResponse = governance(request(state, "/admin/users/minimal"));
    expect(minimalResponse).toBeDefined();
    const minimal = await minimalResponse!.json();
    expect(minimal[0]).toEqual(expect.objectContaining({
      id: state.users[0].id,
      email: state.users[0].email,
      role: state.users[0].role,
    }));
    expect(minimal[0]).not.toHaveProperty("effective_access");
    expect(minimal[0]).not.toHaveProperty("account_links");
  });
});
