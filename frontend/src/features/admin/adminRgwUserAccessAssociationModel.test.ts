import {
  s3UserGroupLinkAdapter,
  s3UserMembershipAdapter,
  s3UserUserLinkAdapter,
} from "./adminRgwUserAccessAssociationModel";

describe("adminRgwUserAccessAssociationModel", () => {
  it("provides typed adapters for every RGW user access association shape", () => {
    const membership = s3UserMembershipAdapter.createLink(11);
    const userLink = s3UserUserLinkAdapter.createLink(12);
    const groupLink = s3UserGroupLinkAdapter.createLink(13);

    expect(s3UserMembershipAdapter.getId(membership)).toBe(11);
    expect(s3UserUserLinkAdapter.getId(userLink)).toBe(12);
    expect(s3UserGroupLinkAdapter.getId(groupLink)).toBe(13);
    expect(s3UserMembershipAdapter.withAccess(membership, true)).toEqual({
      s3_user_id: 11,
      allow_manager_browser_data_access: true,
    });
  });
});
