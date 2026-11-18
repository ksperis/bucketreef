/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { ListActionButton } from "../../components/list/ListControls";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  resetAdminAssociationPicker,
} from "./AdminAssociationPicker";
import type { AdminSimpleIdAssociationsState } from "./AdminSimpleIdAssociationsPanel";
import AdminPrincipalIdentity from "./AdminPrincipalIdentity";
import AdminUnifiedAssociations, { type AdminUnifiedAssociationRow } from "./AdminUnifiedAssociations";
import { useAdminI18n } from "./adminI18n";

type Props = {
  users: AdminSimpleIdAssociationsState;
  groups: AdminSimpleIdAssociationsState;
  maxVisibleOptions: number;
  ensureUsers?: () => void;
  ensureGroups?: () => void;
  normalizeSelection?: (ids: number[]) => number[];
};

export default function AdminSimpleUiAccess({
  users,
  groups,
  maxVisibleOptions,
  ensureUsers,
  ensureGroups,
  normalizeSelection = (ids) => ids,
}: Props) {
  const { text } = useAdminI18n();
  const openUsers = () => {
    resetAdminAssociationPicker(groups);
    users.setSelections([]);
    users.setShowPanel(true);
    ensureUsers?.();
  };
  const openGroups = () => {
    resetAdminAssociationPicker(users);
    groups.setSelections([]);
    groups.setShowPanel(true);
    ensureGroups?.();
  };
  const makeRows = (
    state: AdminSimpleIdAssociationsState,
    kind: "users" | "groups",
  ): AdminUnifiedAssociationRow[] => state.selected.map((id) => {
    const label = state.labelById.get(id) ?? text(kind === "users" ? "User #{id}" : "Group #{id}", { id });
    const fallbackPrincipal = kind === "users"
      ? { kind: "user" as const, email: label, fallback: label }
      : { kind: "group" as const, name: label, fallback: label };
    return {
      key: `${kind}-${id}`,
      resource: <AdminPrincipalIdentity principal={state.principalById?.get(id) ?? fallbackPrincipal} />,
      type: text(kind === "users" ? "UI User" : "UI Group"),
      manager: text("Enabled"),
      actions: (
        <ListActionButton
          type="button"
          variant="danger"
          onClick={() => state.setSelected((current) => current.filter((selectedId) => selectedId !== id))}
        >
          {text("Remove")}
        </ListActionButton>
      ),
    };
  });
  const renderPicker = (state: AdminSimpleIdAssociationsState, kind: "users" | "groups") => (
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
        state.setSelected((current) => normalizeSelection([...current, ...state.selections]));
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
  const rows = [...makeRows(users, "users"), ...makeRows(groups, "groups")];
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
