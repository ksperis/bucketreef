import { describe, expect, it } from "vitest";
import {
  buildAdminUserCreateDraft,
  buildAdminUserEditorDraft,
  emptyAdminUserEditorDraft,
} from "./adminUserEditorDraft";

const emptyEditor = () => emptyAdminUserEditorDraft({ email: "alice@example.com" });

describe("admin user editor drafts", () => {
  it("normalizes inactive LDAP identity fields for local users", () => {
    expect(
      buildAdminUserCreateDraft({
        editor: emptyEditor(),
        source: "local",
        providerId: "ldap-1",
        directoryDn: "uid=alice,ou=people,dc=example,dc=com",
      }),
    ).toEqual(
      buildAdminUserCreateDraft({
        editor: emptyEditor(),
        source: "local",
      }),
    );
  });

  it("tracks the selected LDAP identity in the creation draft", () => {
    const base = buildAdminUserCreateDraft({
      editor: emptyEditor(),
      source: "ldap",
      providerId: "ldap-1",
      directoryDn: "uid=alice,ou=people,dc=example,dc=com",
    });

    expect(
      buildAdminUserCreateDraft({
        editor: emptyEditor(),
        source: "ldap",
        providerId: "ldap-2",
        directoryDn: "uid=alice,ou=people,dc=example,dc=com",
      }),
    ).not.toEqual(base);
    expect(
      buildAdminUserCreateDraft({
        editor: emptyEditor(),
        source: "ldap",
        providerId: "ldap-1",
        directoryDn: "uid=bob,ou=people,dc=example,dc=com",
      }),
    ).not.toEqual(base);
  });

  it("canonicalizes association ordering without losing access choices", () => {
    const left = buildAdminUserEditorDraft({
      form: {
        email: "alice@example.com",
        s3_connection_ids: [9, 2],
        group_ids: [7, 3],
      },
      selectedAccounts: [
        { id: 4, manager_role: null, portal_role: "portal_user", allow_manager_browser_data_access: false },
        { id: 1, manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: true },
      ],
      selectedS3Users: [
        { s3_user_id: 8, allow_manager_browser_data_access: false },
        { s3_user_id: 2, allow_manager_browser_data_access: true },
      ],
      selectedS3Connections: [9, 2],
      selectedOpenStackClouds: [6, 1],
      selectedGroups: [5, 3],
      pendingAccountSelections: [7, 2],
      pendingS3UserSelections: [8, 3],
      pendingConnectionSelections: [9, 4],
      pendingOpenStackSelections: [5, 1],
      pendingGroupSelections: [6, 2],
      accountAccessChoice: {
        7: { manager_role: null, portal_role: "portal_manager", allow_manager_browser_data_access: true },
        2: { manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: false },
      },
    });
    const right = buildAdminUserEditorDraft({
      form: {
        group_ids: [3, 7],
        s3_connection_ids: [2, 9],
        email: "alice@example.com",
      },
      selectedAccounts: [...left.selectedAccounts].reverse(),
      selectedS3Users: [...left.selectedS3Users].reverse(),
      selectedS3Connections: [2, 9],
      selectedOpenStackClouds: [1, 6],
      selectedGroups: [3, 5],
      pendingAccountSelections: [2, 7],
      pendingS3UserSelections: [3, 8],
      pendingConnectionSelections: [4, 9],
      pendingOpenStackSelections: [1, 5],
      pendingGroupSelections: [2, 6],
      accountAccessChoice: {
        2: { manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: false },
        7: { manager_role: null, portal_role: "portal_manager", allow_manager_browser_data_access: true },
      },
    });

    expect(right).toEqual(left);
    expect(left.accountAccessChoice).toEqual({
      2: { manager_role: "account_administrator", portal_role: null, allow_manager_browser_data_access: false },
      7: { manager_role: null, portal_role: "portal_manager", allow_manager_browser_data_access: true },
    });
  });
});
