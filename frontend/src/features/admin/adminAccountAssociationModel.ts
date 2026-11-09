/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { AccountAccessGrant } from "../../api/accountAccess";
import type { AccountMembership } from "../../api/users";

export type AdminAccountSelection = AccountAccessGrant & {
  id: number;
};

export function accountMembershipsToSelections(
  links: AccountMembership[],
): AdminAccountSelection[] {
  return links.map((link) => ({
    id: Number(link.account_id),
    manager_role: link.manager_role,
    portal_role: link.portal_role,
    allow_manager_browser_data_access: link.allow_manager_browser_data_access,
  }));
}

export function accountSelectionsToMemberships(
  selections: AdminAccountSelection[],
): AccountMembership[] {
  return selections.map(({ id, ...access }) => ({
    account_id: id,
    ...access,
  }));
}
