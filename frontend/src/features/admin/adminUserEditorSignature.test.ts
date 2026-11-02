import { describe, expect, it } from "vitest";
import { adminUserCreateSignature } from "./adminUserEditorSignature";

describe("adminUserCreateSignature", () => {
  it("normalizes inactive LDAP identity fields for local users", () => {
    expect(
      adminUserCreateSignature({
        editor: "editor-signature",
        source: "local",
        providerId: "ldap-1",
        directoryDn: "uid=alice,ou=people,dc=example,dc=com",
      }),
    ).toBe(
      adminUserCreateSignature({
        editor: "editor-signature",
        source: "local",
      }),
    );
  });

  it("tracks the selected LDAP identity in the creation signature", () => {
    const base = adminUserCreateSignature({
      editor: "editor-signature",
      source: "ldap",
      providerId: "ldap-1",
      directoryDn: "uid=alice,ou=people,dc=example,dc=com",
    });

    expect(
      adminUserCreateSignature({
        editor: "editor-signature",
        source: "ldap",
        providerId: "ldap-2",
        directoryDn: "uid=alice,ou=people,dc=example,dc=com",
      }),
    ).not.toBe(base);
    expect(
      adminUserCreateSignature({
        editor: "editor-signature",
        source: "ldap",
        providerId: "ldap-1",
        directoryDn: "uid=bob,ou=people,dc=example,dc=com",
      }),
    ).not.toBe(base);
  });
});
