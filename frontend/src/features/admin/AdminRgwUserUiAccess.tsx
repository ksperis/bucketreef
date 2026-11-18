/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { ListActionButton, ListActions } from "../../components/list/ListControls";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  resetAdminAssociationPicker,
} from "./AdminAssociationPicker";
import type {
  AdminRgwUserAccessAssociationsState,
} from "./AdminRgwUserAccessAssociationsPanel";
import type { AdminRgwUserAccessLink } from "./adminRgwUserAccessAssociationModel";
import AdminPrincipalIdentity from "./AdminPrincipalIdentity";
import AdminUnifiedAssociations, { type AdminUnifiedAssociationRow } from "./AdminUnifiedAssociations";
import { useAdminI18n } from "./adminI18n";

type Props<TUserLink extends AdminRgwUserAccessLink, TGroupLink extends AdminRgwUserAccessLink> = {
  users: AdminRgwUserAccessAssociationsState<TUserLink>;
  groups: AdminRgwUserAccessAssociationsState<TGroupLink>;
  maxVisibleOptions: number;
  ensureUsers: () => void;
  ensureGroups: () => void;
};

export default function AdminRgwUserUiAccess<
  TUserLink extends AdminRgwUserAccessLink,
  TGroupLink extends AdminRgwUserAccessLink,
>({ users, groups, maxVisibleOptions, ensureUsers, ensureGroups }: Props<TUserLink, TGroupLink>) {
  const { text } = useAdminI18n();

  const openUsers = () => {
    resetAdminAssociationPicker(groups);
    users.setSelections([]);
    users.setShowPanel(true);
    ensureUsers();
  };
  const openGroups = () => {
    resetAdminAssociationPicker(users);
    groups.setSelections([]);
    groups.setShowPanel(true);
    ensureGroups();
  };

  const userRows: AdminUnifiedAssociationRow[] = users.selected.map((entry) => {
    const id = users.adapter.getId(entry);
    const label = users.labelById.get(id) ?? text("User #{id}", { id });
    return {
      key: `user-${id}`,
      resource: (
        <AdminPrincipalIdentity
          principal={users.principalById?.get(id) ?? { kind: "user", email: label, fallback: label }}
        />
      ),
      type: text("UI User"),
      manager: text(entry.allow_manager_browser_data_access ? "Browser data enabled" : "Browser data disabled"),
      actions: (
        <ListActions>
          <AdminAssociationAdvancedSettings
            targetLabel={label}
            associationKind="rgw_user"
            allowManagerBrowserDataAccess={Boolean(entry.allow_manager_browser_data_access)}
            onApply={(allowed) =>
              users.setSelected((current) => current.map((item) =>
                users.adapter.getId(item) === id ? users.adapter.withAccess(item, allowed) : item,
              ))
            }
          />
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() => users.setSelected((current) => current.filter((item) => users.adapter.getId(item) !== id))}
          >
            {text("Remove")}
          </ListActionButton>
        </ListActions>
      ),
    };
  });

  const groupRows: AdminUnifiedAssociationRow[] = groups.selected.map((entry) => {
    const id = groups.adapter.getId(entry);
    const label = groups.labelById.get(id) ?? text("Group #{id}", { id });
    return {
      key: `group-${id}`,
      resource: (
        <AdminPrincipalIdentity
          principal={groups.principalById?.get(id) ?? { kind: "group", name: label, fallback: label }}
        />
      ),
      type: text("UI Group"),
      manager: text(entry.allow_manager_browser_data_access ? "Browser data enabled" : "Browser data disabled"),
      actions: (
        <ListActions>
          <AdminAssociationAdvancedSettings
            targetLabel={label}
            associationKind="rgw_user"
            allowManagerBrowserDataAccess={Boolean(entry.allow_manager_browser_data_access)}
            onApply={(allowed) =>
              groups.setSelected((current) => current.map((item) =>
                groups.adapter.getId(item) === id ? groups.adapter.withAccess(item, allowed) : item,
              ))
            }
          />
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() => groups.setSelected((current) => current.filter((item) => groups.adapter.getId(item) !== id))}
          >
            {text("Remove")}
          </ListActionButton>
        </ListActions>
      ),
    };
  });

  const renderPicker = <TLink extends AdminRgwUserAccessLink>(
    state: AdminRgwUserAccessAssociationsState<TLink>,
    kind: "users" | "groups",
  ) => (
    <AdminAssociationPickerPanel
      title={text(kind === "users" ? "Add UI users" : "Add UI groups")}
      hint={text(kind === "users" ? "(filter by email)" : "(filter by name)")}
      search={state.search}
      onSearchChange={state.setSearch}
      searchAriaLabel={text(kind === "users" ? "Search UI users" : "Search UI groups")}
      loading={state.loading}
      availableCount={state.available.length}
      maxVisibleOptions={maxVisibleOptions}
      selectedCount={state.selections.length}
      loadingLabel={text(kind === "users" ? "Loading UI users..." : "Loading UI groups...")}
      pagination={state.pagination}
      addDisabled={state.selections.length === 0}
      onCancel={() => resetAdminAssociationPicker(state)}
      onAdd={() => {
        if (!state.selections.length) return;
        state.setSelected((current) => [
          ...current,
          ...state.selections.map(state.adapter.createLink),
        ]);
        resetAdminAssociationPicker(state);
      }}
    >
      <AdminAssociationCheckboxOptions
        options={state.visible}
        selectedIds={state.selections}
        onToggle={state.toggleSelection}
        getLabel={(option) => option.label}
      />
    </AdminAssociationPickerPanel>
  );

  const rows = [...userRows, ...groupRows];
  return (
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
        { key: "users", label: text("Add UI users"), onAction: openUsers },
        { key: "groups", label: text("Add UI groups"), onAction: openGroups },
      ]}
      picker={users.showPanel ? renderPicker(users, "users") : groups.showPanel ? renderPicker(groups, "groups") : undefined}
    />
  );
}
