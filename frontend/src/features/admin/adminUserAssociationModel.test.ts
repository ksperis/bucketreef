import { describe, expect, it } from "vitest";
import { adminUserAssociationSelection } from "./adminUserAssociationModel";

describe("adminUserAssociationModel", () => {
  it("projects persisted associations into editor selections", () => {
    expect(adminUserAssociationSelection({
      account_links: [{
        account_id: 7,
        manager_role: "account_administrator",
        portal_role: "portal_user",
        allow_manager_browser_data_access: true,
      }],
      s3_user_links: [{
        s3_user_id: 8,
        allow_manager_browser_data_access: true,
      }],
      s3_connection_details: [{ id: 9, name: "Private S3" }],
      group_details: [{ id: 10, name: "Operators" }],
      openstack_cloud_details: [{ id: 11, name: "Production" }],
    })).toEqual({
      accounts: [{
        id: 7,
        manager_role: "account_administrator",
        portal_role: "portal_user",
        allow_manager_browser_data_access: true,
      }],
      s3Users: [{
        s3_user_id: 8,
        allow_manager_browser_data_access: true,
      }],
      connections: [9],
      groups: [10],
      openStack: [11],
    });
  });
});
