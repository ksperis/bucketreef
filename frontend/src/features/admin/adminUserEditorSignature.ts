/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { AccountAccessGrant } from "../../api/accountAccess";
import type { CreateUserPayload, S3UserMembership, UpdateUserPayload } from "../../api/users";
import { stableSignature } from "../../utils/stableSignature";
import type { AccountSelection } from "./UserAccountAssociationsPanel";

type AdminUserEditorSignatureInput = {
  form: CreateUserPayload | UpdateUserPayload;
  selectedAccounts: AccountSelection[];
  selectedS3Users: S3UserMembership[];
  selectedS3Connections: number[];
  selectedGroups: number[];
  pendingAccountSelections: number[];
  pendingS3UserSelections: number[];
  pendingConnectionSelections: number[];
  pendingGroupSelections: number[];
  accountAccessChoice: Record<number, AccountAccessGrant>;
};

export function adminUserEditorSignature(input: AdminUserEditorSignatureInput): string {
  return stableSignature(input);
}

export function emptyAdminUserEditorSignature(
  form: CreateUserPayload | UpdateUserPayload,
): string {
  return adminUserEditorSignature({
    form,
    selectedAccounts: [],
    selectedS3Users: [],
    selectedS3Connections: [],
    selectedGroups: [],
    pendingAccountSelections: [],
    pendingS3UserSelections: [],
    pendingConnectionSelections: [],
    pendingGroupSelections: [],
    accountAccessChoice: {},
  });
}
