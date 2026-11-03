/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { AccountAccessGrant } from "../../api/accountAccess";
import type { CreateUserPayload, S3UserMembership, UpdateUserPayload } from "../../api/users";
import { canonicalizeStableValue } from "../../utils/stableSignature";
import type { AdminAccountSelection } from "./AdminAccountAssociationsPanel";

type AdminUserEditorDraftInput = {
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

type AdminUserCreateDraftInput = {
  editor: AdminUserEditorDraft;
  source: "local" | "ldap";
  providerId?: string;
  directoryDn?: string | null;
};

function canonicalS3UserMemberships(values: S3UserMembership[]) {
  return [...values].sort(
    (left, right) => Number(left.s3_user_id) - Number(right.s3_user_id),
  );
}

function canonicalForm(form: CreateUserPayload | UpdateUserPayload) {
  return {
    ...form,
    ...(form.account_links
      ? {
          account_links: [...form.account_links].sort(
            (left, right) => Number(left.account_id) - Number(right.account_id),
          ),
        }
      : {}),
    ...(form.s3_user_links
      ? { s3_user_links: canonicalS3UserMemberships(form.s3_user_links) }
      : {}),
  };
}

export function buildAdminUserEditorDraft(input: AdminUserEditorDraftInput) {
  return canonicalizeStableValue({
    ...input,
    form: canonicalForm(input.form),
    selectedS3Users: canonicalS3UserMemberships(input.selectedS3Users),
  });
}

type AdminUserEditorDraft = ReturnType<typeof buildAdminUserEditorDraft>;

export function emptyAdminUserEditorDraft(
  form: CreateUserPayload | UpdateUserPayload,
): AdminUserEditorDraft {
  return buildAdminUserEditorDraft({
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

export function buildAdminUserCreateDraft({
  editor,
  source,
  providerId = "",
  directoryDn = null,
}: AdminUserCreateDraftInput) {
  const ldapIdentity = source === "ldap";
  return canonicalizeStableValue({
    editor,
    identity: {
      source,
      provider_id: ldapIdentity ? providerId : "",
      directory_dn: ldapIdentity ? directoryDn : null,
    },
  });
}

export function emptyAdminUserCreateDraft(form: CreateUserPayload) {
  return buildAdminUserCreateDraft({
    editor: emptyAdminUserEditorDraft(form),
    source: "local",
  });
}
