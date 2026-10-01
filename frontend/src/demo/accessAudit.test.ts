import { describe, expect, it } from "vitest";
import { buildDemoAccessAuditRows, listDemoS3Users } from "./accessAudit";
import { createSeed } from "./state";

describe("demo access audit", () => {
  it("reflects direct and UI Group provenance from the demo governance state", () => {
    const state = createSeed();
    const rows = buildDemoAccessAuditRows(state);
    const designGroup = state.groups.find(group => group.name === "Design");
    const manager = state.users[1];

    expect(designGroup).toBeDefined();
    const account = rows.find(row =>
      row.principal.id === manager.id
      && row.scope === "rgw_account"
      && row.target.id === state.accounts[0].id
    );
    expect(account).toBeDefined();
    expect(account?.rights.find(right => right.code === "account_administrator")?.sources).toEqual([
      { kind: "direct" },
      { kind: "group", group_id: designGroup?.id, group_name: designGroup?.name },
    ]);

    const connection = rows.find(row => row.scope === "s3_connection" && row.target.id === state.connections[0].id);
    expect(connection?.rights.find(right => right.code === "shared_connection_access")?.sources).toEqual([
      { kind: "direct" },
    ]);
  });

  it("keeps the RGW User list associations consistent with the audit inventory", () => {
    const state = createSeed();
    const rgwUserId = state.accounts[0].id * 100;
    state.users[1].s3_user_links = [{ s3_user_id: rgwUserId, allow_manager_browser_data_access: true }];
    state.groups[2].s3_user_links = [{ s3_user_id: rgwUserId, allow_manager_browser_data_access: false }];

    const rgwUser = listDemoS3Users(state).find(user => user.id === rgwUserId);
    expect(rgwUser?.user_links).toEqual([
      expect.objectContaining({ user_id: state.users[1].id, allow_manager_browser_data_access: true }),
    ]);
    expect(rgwUser?.group_links).toEqual([
      expect.objectContaining({ group_id: state.groups[2].id, allow_manager_browser_data_access: false }),
    ]);

    const audit = buildDemoAccessAuditRows(state).find(row =>
      row.principal.id === state.users[1].id
      && row.scope === "rgw_user"
      && row.target.id === rgwUserId
    );
    expect(audit?.rights.find(right => right.code === "rgw_user_access")?.sources).toEqual([
      { kind: "direct" },
      { kind: "group", group_id: state.groups[2].id, group_name: state.groups[2].name },
    ]);
  });
});
