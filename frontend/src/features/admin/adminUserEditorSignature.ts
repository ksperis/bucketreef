/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { AccountAccessGrant } from "../../api/accountAccess";
import type { CreateUserPayload, S3UserMembership, UpdateUserPayload } from "../../api/users";
import { stableSignature } from "../../utils/stableSignature";
import type { AdminAccountSelection } from "./AdminAccountAssociationsPanel";

type AdminUserEditorSignatureInput = {
  form: CreateUserPayload | UpdateUserPayload;
  selectedAccounts: AdminAccountSelection[];
  selectedS3Users: S3UserMembership[];
  selectedS3Connections: number[];
  selectedOpenStackClouds: number[];
  selectedGroups: number[];
  pendingAccountSelections: number[];
  pendingS3UserSelections: number[];
  pendingConnectionSelections: number[];
  pendingOpenStackSelections: number[];
  pendingGroupSelections: number[];
  accountAccessChoice: Record<number, AccountAccessGrant>;
};

type AdminUserCreateSignatureInput = {
  editor: string;
  source: "local" | "ldap";
  providerId?: string;
  directoryDn?: string | null;
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
    selectedOpenStackClouds: [],
    selectedGroups: [],
    pendingAccountSelections: [],
    pendingS3UserSelections: [],
    pendingConnectionSelections: [],
    pendingOpenStackSelections: [],
    pendingGroupSelections: [],
    accountAccessChoice: {},
  });
}

export function adminUserCreateSignature({
  editor,
  source,
  providerId = "",
  directoryDn = null,
}: AdminUserCreateSignatureInput): string {
  const ldapIdentity = source === "ldap";
  return stableSignature({
    editor,
    identity: {
      source,
      provider_id: ldapIdentity ? providerId : "",
      directory_dn: ldapIdentity ? directoryDn : null,
    },
  });
}
