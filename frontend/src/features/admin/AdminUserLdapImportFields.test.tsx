import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LdapImportSearchItem } from "../../api/users";
import AdminUserLdapImportFields from "./AdminUserLdapImportFields";
import type { UsersText } from "./usersMessage";

const text: UsersText = (key) => key;

function renderFields({
  items = [],
  onSearch = vi.fn(),
  onLinkExisting = vi.fn(),
}: {
  items?: LdapImportSearchItem[];
  onSearch?: () => void;
  onLinkExisting?: (item: LdapImportSearchItem) => void;
} = {}) {
  render(
    <AdminUserLdapImportFields
      source="ldap"
      onSourceChange={vi.fn()}
      providers={[{ id: "corp", display_name: "Corporate LDAP" }]}
      providersLoading={false}
      providerId="corp"
      onProviderChange={vi.fn()}
      query="alice"
      onQueryChange={vi.fn()}
      onSearch={onSearch}
      searchLoading={false}
      searchError={null}
      items={items}
      truncated={false}
      searchPerformed={items.length > 0}
      selected={null}
      onSelect={vi.fn()}
      onLinkExisting={onLinkExisting}
      onRestore={vi.fn()}
      busy={false}
      text={text}
    />,
  );
}

describe("AdminUserLdapImportFields", () => {
  it("submits a valid directory search with Enter", () => {
    const onSearch = vi.fn();
    renderFields({ onSearch });

    fireEvent.keyDown(screen.getByLabelText("searchLdapDirectory"), { key: "Enter" });

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("offers only explicit linking when the LDAP email already belongs to a UI user", () => {
    const onLinkExisting = vi.fn();
    const item: LdapImportSearchItem = {
      selection_token: "selection-existing",
      provider_id: "corp",
      email: "existing@example.com",
      full_name: "Existing Directory User",
      directory_dn: "uid=existing,ou=people,dc=example,dc=com",
      identity_state: "available",
      linked_user: null,
      email_match_user: {
        id: 12,
        email: "existing@example.com",
        full_name: "Existing UI User",
        role: "ui_user",
      },
    };
    renderFields({ items: [item], onLinkExisting });

    expect(screen.getByRole("list", { name: "ldapSearchResults" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "useLdapEntry" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "linkExistingUser" }));

    expect(onLinkExisting).toHaveBeenCalledWith(item);
  });
});
