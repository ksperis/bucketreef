import {
  accountMembershipsToSelections,
  accountSelectionsToMemberships,
} from "./adminAccountAssociationModel";

describe("adminAccountAssociationModel", () => {
  it("converts account memberships to picker selections and back", () => {
    const memberships = [{
      account_id: 21,
      manager_role: "account_administrator" as const,
      portal_role: "portal_user" as const,
      allow_manager_browser_data_access: true,
    }];

    const selections = accountMembershipsToSelections(memberships);

    expect(selections).toEqual([{
      id: 21,
      manager_role: "account_administrator",
      portal_role: "portal_user",
      allow_manager_browser_data_access: true,
    }]);
    expect(accountSelectionsToMemberships(selections)).toEqual(memberships);
  });
});
