/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useMemo, useState } from "react";
import type { AccountGroupLink, AccountUserLink } from "../../api/accounts";
import {
  defaultAccountAccessGrant,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import { listGroupOptions } from "../../api/groups";
import { listUserOptions } from "../../api/users";
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import usePaginatedOptions, { type PaginatedOptionsQuery } from "../../hooks/usePaginatedOptions";
import type { PaginatedResponse } from "../../api/types";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationAccessPickerTable,
  AdminAssociationPickerPanel,
} from "./AdminAssociationPicker";
import {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
import AdminUnifiedAssociations, { type AdminUnifiedAssociationRow } from "./AdminUnifiedAssociations";
import AdminPrincipalIdentity, { type AdminPrincipalPresentation } from "./AdminPrincipalIdentity";
import { useAdminI18n } from "./adminI18n";

type Principal = { id: number; label: string; presentation: AdminPrincipalPresentation };
type PrincipalKind = "users" | "groups";

type Props = {
  userLinks: AccountUserLink[];
  groupLinks: AccountGroupLink[];
  onUserLinksChange: (links: AccountUserLink[]) => void;
  onGroupLinksChange: (links: AccountGroupLink[]) => void;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
};

const loadUsers = async (query: PaginatedOptionsQuery): Promise<PaginatedResponse<Principal>> => {
  const response = await listUserOptions(query);
  return {
    ...response,
    items: response.items.map((user) => ({
      id: user.id,
      label: user.email,
      presentation: {
        kind: "user",
        email: user.email,
        fullName: user.full_name,
        avatar: user.avatar,
        fallback: user.email,
      },
    })),
  };
};

const loadGroups = async (query: PaginatedOptionsQuery): Promise<PaginatedResponse<Principal>> => {
  const response = await listGroupOptions(query);
  return {
    ...response,
    items: response.items.map((group) => ({
      id: group.id,
      label: group.name,
      presentation: {
        kind: "group",
        name: group.name,
        description: group.description,
        avatar: group.avatar,
        fallback: group.name,
      },
    })),
  };
};

export default function AdminAccountUiAccess({
  userLinks,
  groupLinks,
  onUserLinksChange,
  onGroupLinksChange,
  disabled,
  onPendingChange,
}: Props) {
  const { text } = useAdminI18n();
  const [activeKind, setActiveKind] = useState<PrincipalKind | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedPrincipals, setSelectedPrincipals] = useState<Record<number, Principal>>({});
  const [choices, setChoices] = useState<Record<number, AccountAccessGrant>>({});
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const userCatalog = usePaginatedOptions(loadUsers, { enabled: activeKind === "users" });
  const groupCatalog = usePaginatedOptions(loadGroups, { enabled: activeKind === "groups" });

  useEffect(() => {
    onPendingChange(selected.length > 0 || advancedDirty);
    return () => onPendingChange(false);
  }, [advancedDirty, onPendingChange, selected.length]);

  const clearPending = () => {
    setSelected([]);
    setSelectedPrincipals({});
    setChoices({});
  };
  const closePicker = () => {
    setActiveKind(null);
    clearPending();
  };
  const openPicker = (kind: PrincipalKind) => {
    clearPending();
    setActiveKind(kind);
  };
  const access = (id: number) => choices[id] ?? defaultAccountAccessGrant();

  const rows = useMemo<AdminUnifiedAssociationRow[]>(() => {
    const changeUserAccess = (target: AccountUserLink, grant: AccountAccessGrant) =>
      onUserLinksChange(userLinks.map((link) => link.user_id === target.user_id ? { ...link, ...grant } : link));
    const changeGroupAccess = (target: AccountGroupLink, grant: AccountAccessGrant) =>
      onGroupLinksChange(groupLinks.map((link) => link.group_id === target.group_id ? { ...link, ...grant } : link));

    const buildManagerAccess = (
      label: string,
      link: AccountUserLink | AccountGroupLink,
      errorId: string,
      onChange: (grant: AccountAccessGrant) => void,
    ) => (
      <ManagerAccountRoleSelect
        label={label}
        value={link}
        onChange={onChange}
        showLabel={false}
        invalid={!hasAccountAccessRole(link)}
        describedBy={!hasAccountAccessRole(link) ? errorId : undefined}
        fieldClassName="w-full md:w-48"
      />
    );
    const buildPortalAccess = (
      label: string,
      link: AccountUserLink | AccountGroupLink,
      errorId: string,
      onChange: (grant: AccountAccessGrant) => void,
    ) => (
      <PortalAccountRoleSelect
        label={label}
        value={link}
        onChange={onChange}
        showLabel={false}
        invalid={!hasAccountAccessRole(link)}
        describedBy={!hasAccountAccessRole(link) ? errorId : undefined}
        fieldClassName="w-full md:w-44"
      />
    );

    return [
      ...userLinks.map((link): AdminUnifiedAssociationRow => {
        const label = link.user_email || `User #${link.user_id}`;
        const errorId = `account-ui-user-${link.user_id}-access-error`;
        return {
          key: `user-${link.user_id}`,
          resource: (
            <>
              <AdminPrincipalIdentity principal={{
                kind: "user",
                email: link.user_email,
                fullName: link.user_full_name,
                avatar: link.user_avatar,
                fallback: label,
              }} />
              <AccountAccessRoleValidationMessage id={errorId} value={link} />
            </>
          ),
          type: text("UI User"),
          manager: buildManagerAccess(label, link, errorId, (grant) => changeUserAccess(link, grant)),
          portal: buildPortalAccess(label, link, errorId, (grant) => changeUserAccess(link, grant)),
          actions: (
            <ListActions>
              {link.manager_role ? (
                <AdminAssociationAdvancedSettings
                  targetLabel={label}
                  associationKind="account"
                  allowManagerBrowserDataAccess={link.allow_manager_browser_data_access}
                  disabled={disabled}
                  onDirtyChange={setAdvancedDirty}
                  onApply={(allowed) => changeUserAccess(link, { ...link, allow_manager_browser_data_access: allowed })}
                />
              ) : null}
              <ListActionButton
                type="button"
                variant="danger"
                disabled={disabled}
                onClick={() => onUserLinksChange(userLinks.filter((item) => item.user_id !== link.user_id))}
              >
                {text("Remove")}
              </ListActionButton>
            </ListActions>
          ),
        };
      }),
      ...groupLinks.map((link): AdminUnifiedAssociationRow => {
        const label = link.group_name || `Group #${link.group_id}`;
        const errorId = `account-ui-group-${link.group_id}-access-error`;
        return {
          key: `group-${link.group_id}`,
          resource: (
            <>
              <AdminPrincipalIdentity principal={{
                kind: "group",
                name: link.group_name,
                description: link.group_description,
                avatar: link.group_avatar,
                fallback: label,
              }} />
              <AccountAccessRoleValidationMessage id={errorId} value={link} />
            </>
          ),
          type: text("UI Group"),
          manager: buildManagerAccess(label, link, errorId, (grant) => changeGroupAccess(link, grant)),
          portal: buildPortalAccess(label, link, errorId, (grant) => changeGroupAccess(link, grant)),
          actions: (
            <ListActions>
              {link.manager_role ? (
                <AdminAssociationAdvancedSettings
                  targetLabel={label}
                  associationKind="account"
                  allowManagerBrowserDataAccess={link.allow_manager_browser_data_access}
                  disabled={disabled}
                  onDirtyChange={setAdvancedDirty}
                  onApply={(allowed) => changeGroupAccess(link, { ...link, allow_manager_browser_data_access: allowed })}
                />
              ) : null}
              <ListActionButton
                type="button"
                variant="danger"
                disabled={disabled}
                onClick={() => onGroupLinksChange(groupLinks.filter((item) => item.group_id !== link.group_id))}
              >
                {text("Remove")}
              </ListActionButton>
            </ListActions>
          ),
        };
      }),
    ];
  }, [disabled, groupLinks, onGroupLinksChange, onUserLinksChange, text, userLinks]);

  const kindLinks = activeKind === "users" ? userLinks : groupLinks;
  const linkedIds = new Set(kindLinks.map((link) => activeKind === "users"
    ? (link as AccountUserLink).user_id
    : (link as AccountGroupLink).group_id));
  const catalog = activeKind === "users" ? userCatalog : groupCatalog;
  const available = activeKind ? catalog.items.filter((principal) => !linkedIds.has(principal.id)) : [];
  const invalidPending = selected.some((id) => !hasAccountAccessRole(access(id)));

  const picker = activeKind ? (
    <AdminAssociationPickerPanel
      title={text(activeKind === "users" ? "Add UI users" : "Add UI groups")}
      search={catalog.search}
      onSearchChange={catalog.setSearch}
      searchAriaLabel={text(activeKind === "users" ? "Search UI users" : "Search UI groups")}
      loading={catalog.loading || Boolean(catalog.error)}
      loadingLabel={catalog.error
        ? text("The catalogue is unavailable.")
        : text(activeKind === "users" ? "Loading UI users..." : "Loading UI groups...")}
      availableCount={available.length}
      maxVisibleOptions={catalog.pageSize}
      selectedCount={selected.length}
      pagination={{
        page: catalog.page,
        pageSize: catalog.pageSize,
        total: catalog.total,
        onPageChange: catalog.setPage,
        onPageSizeChange: catalog.setPageSize,
      }}
      onCancel={closePicker}
      onAdd={() => {
        if (!selected.length || invalidPending) return;
        const added = selected
          .map((id) => selectedPrincipals[id])
          .filter((principal): principal is Principal => Boolean(principal) && !linkedIds.has(principal.id));
        if (activeKind === "users") {
          onUserLinksChange([
            ...userLinks,
            ...added.map((principal) => {
              const presentation = principal.presentation;
              return {
                user_id: principal.id,
                user_email: presentation.kind === "user" ? presentation.email ?? principal.label : principal.label,
                user_full_name: presentation.kind === "user" ? presentation.fullName ?? null : null,
                user_avatar: presentation.kind === "user" ? presentation.avatar ?? null : null,
                ...access(principal.id),
                allow_manager_browser_data_access: false,
              };
            }),
          ]);
        } else {
          onGroupLinksChange([
            ...groupLinks,
            ...added.map((principal) => {
              const presentation = principal.presentation;
              return {
                group_id: principal.id,
                group_name: presentation.kind === "group" ? presentation.name ?? principal.label : principal.label,
                group_description: presentation.kind === "group" ? presentation.description ?? null : null,
                group_avatar: presentation.kind === "group" ? presentation.avatar ?? null : null,
                ...access(principal.id),
                allow_manager_browser_data_access: false,
              };
            }),
          ]);
        }
        closePicker();
      }}
      addDisabled={disabled || catalog.loading || Boolean(catalog.error) || !selected.length || invalidPending}
    >
      {!catalog.loading && !catalog.error ? (
        <AdminAssociationAccessPickerTable
          title={text(activeKind === "users" ? "Available UI users" : "Available UI groups")}
          principalLabel={text(activeKind === "users" ? "User" : "Group")}
          options={available.map((principal) => ({
            id: principal.id,
            label: principal.label,
            selected: selected.includes(principal.id),
            access: access(principal.id),
          }))}
          onToggle={(id) => {
            const principal = available.find((item) => item.id === id);
            const wasSelected = selected.includes(id);
            setSelected((current) => current.includes(id)
              ? current.filter((selectedId) => selectedId !== id)
              : [...current, id]);
            setSelectedPrincipals((current) => {
              const next = { ...current };
              if (wasSelected) delete next[id];
              else if (principal) next[id] = principal;
              return next;
            });
          }}
          onAccessChange={(id, grant) => setChoices((current) => ({ ...current, [id]: grant }))}
        />
      ) : null}
    </AdminAssociationPickerPanel>
  ) : undefined;

  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="sr-only">{text("User access")}</legend>
      <AdminUnifiedAssociations
        title={text("User access")}
        rows={rows}
        resourceLabel={text("Principal")}
        typeLabel={text("Type")}
        managerLabel={text("Manager")}
        portalLabel={text("Portal")}
        actionsLabel={text("Actions")}
        emptyMessage={text("No user access is linked yet.")}
        countLabel={text("{count} linked", { count: rows.length })}
        addActions={[
          { key: "users", label: text("Add UI users"), onAction: () => openPicker("users"), disabled },
          { key: "groups", label: text("Add UI groups"), onAction: () => openPicker("groups"), disabled },
        ]}
        picker={picker}
      />
    </fieldset>
  );
}
