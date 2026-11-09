/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { S3UserMembership, User } from "../../api/users";
import {
  accountMembershipsToSelections,
  type AdminAccountSelection,
} from "./adminAccountAssociationModel";

export type AdminUserAssociationSelection = {
  accounts: AdminAccountSelection[];
  s3Users: S3UserMembership[];
  connections: number[];
  groups: number[];
  openStack: number[];
};

type AdminUserAssociationSource = Pick<
  User,
  | "account_links"
  | "s3_user_links"
  | "s3_connection_details"
  | "group_details"
  | "openstack_cloud_details"
>;

export function adminUserAssociationSelection(
  user: AdminUserAssociationSource,
): AdminUserAssociationSelection {
  return {
    accounts: accountMembershipsToSelections(user.account_links),
    s3Users: user.s3_user_links.map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: link.allow_manager_browser_data_access,
    })),
    connections: user.s3_connection_details.map((connection) => Number(connection.id)),
    groups: user.group_details.map((group) => Number(group.id)),
    openStack: user.openstack_cloud_details.map((cloud) => Number(cloud.id)),
  };
}
