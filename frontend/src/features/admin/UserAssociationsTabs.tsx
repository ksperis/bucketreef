/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import type { Dispatch, SetStateAction } from "react";
import type { S3UserMembership } from "../../api/users";

import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import { AdminAssociationCheckboxOptions, AdminAssociationPickerPanel, AdminAssociationTabs, adminAssociationTableContainerClass } from "./AdminAssociationPicker";
import UserAccountAssociationsPanel, {
  type UserAccountAssociationsState,
} from "./UserAccountAssociationsPanel";
import { useUserI18n } from "./userMessage";
import type { StorageAssociationTab } from "./useAdminStorageAssociationEditorState";

type AssociationOption = {
  id: number;
  label: string;
};

type S3UserAssociationsState = {
  selected: S3UserMembership[];
  setSelected: Dispatch<SetStateAction<S3UserMembership[]>>;
  labelById: Map<number, string>;
  available: AssociationOption[];
  visible: AssociationOption[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  loading: boolean;
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
  toggleSelection: (id: number) => void;
};

type SimpleIdAssociationsState = {
  selected: number[];
  setSelected: Dispatch<SetStateAction<number[]>>;
  labelById: Map<number, string>;
  available: AssociationOption[];
  visible: AssociationOption[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  loading: boolean;
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
  toggleSelection: (id: number) => void;
};

type UserAssociationsTabsProps = {
  activeTab: StorageAssociationTab;
  onTabChange: (tab: StorageAssociationTab) => void;
  maxVisibleOptions: number;
  showPortalRole: boolean;
  accounts: UserAccountAssociationsState;
  s3Users: S3UserAssociationsState;
  connections: SimpleIdAssociationsState;
  openstack?: SimpleIdAssociationsState;
};

type SimpleIdAssociationsPanelProps = {
  state: SimpleIdAssociationsState;
  columns: DataTableColumn<number>[];
  maxVisibleOptions: number;
  loadingMessage: string;
  emptyMessage: string;
  pickerTitle: string;
  searchHint: string;
};

function SimpleIdAssociationsPanel({
  state,
  columns,
  maxVisibleOptions,
  loadingMessage,
  emptyMessage,
  pickerTitle,
  searchHint,
}: SimpleIdAssociationsPanelProps) {
  const resetPicker = () => {
    state.setShowPanel(false);
    state.setSelections([]);
    state.setSearch("");
  };

  return (
    <div className="space-y-3">
      <DataTableShell
        columns={columns}
        rows={state.selected}
        rowKey={(id) => id}
        status={state.selected.length ? "ready" : "empty"}
        loadingMessage={loadingMessage}
        errorMessage={emptyMessage}
        emptyMessage={emptyMessage}
        containerClassName={adminAssociationTableContainerClass}
        responsiveCards
      />
      {state.showPanel ? (
        <AdminAssociationPickerPanel
          title={pickerTitle}
          hint={searchHint}
          search={state.search}
          onSearchChange={state.setSearch}
          loading={state.loading}
          availableCount={state.available.length}
          maxVisibleOptions={maxVisibleOptions}
          selectedCount={state.selections.length}
          loadingLabel={loadingMessage}
          addDisabled={state.selections.length === 0}
          onCancel={resetPicker}
          onAdd={() => {
            if (state.selections.length === 0) return;
            state.setSelected((current) => [...current, ...state.selections]);
            resetPicker();
          }}
        >
          <AdminAssociationCheckboxOptions
            options={state.visible}
            selectedIds={state.selections}
            onToggle={state.toggleSelection}
            getLabel={(option) => option.label}
          />
        </AdminAssociationPickerPanel>
      ) : null}
    </div>
  );
}

export default function UserAssociationsTabs({
  activeTab,
  onTabChange,
  maxVisibleOptions,
  showPortalRole,
  accounts,
  s3Users,
  connections,
  openstack,
}: UserAssociationsTabsProps) {
  const { text } = useUserI18n();
  const s3UserColumns: DataTableColumn<S3UserMembership>[] = [
    {
      id: "user",
      label: text("user"),
      primary: true,
      render: (entry) =>
        s3Users.labelById.get(entry.s3_user_id) ??
        text("userById", { id: entry.s3_user_id }),
    },
    {
      id: "actions",
      label: text("actions"),
      align: "right",
      mobileRole: "actions",
      render: (entry) => {
        const label =
          s3Users.labelById.get(entry.s3_user_id) ??
          text("userById", { id: entry.s3_user_id });
        return (
          <ListActions>
            <AdminAssociationAdvancedSettings
              targetLabel={label}
              associationKind="rgw_user"
              allowManagerBrowserDataAccess={Boolean(
                entry.allow_manager_browser_data_access,
              )}
              onApply={(allowed) =>
                s3Users.setSelected((current) =>
                  current.map((item) =>
                    item.s3_user_id === entry.s3_user_id
                      ? {
                          ...item,
                          allow_manager_browser_data_access: allowed,
                        }
                      : item,
                  ),
                )
              }
            />
            <ListActionButton
              type="button"
              onClick={() =>
                s3Users.setSelected((current) =>
                  current.filter((item) => item.s3_user_id !== entry.s3_user_id),
                )
              }
              variant="danger"
            >
              {text("remove")}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];
  const simpleAssociationColumns = (
    primaryLabel: string,
    labelById: Map<number, string>,
    fallbackLabel: (id: number) => string,
    onRemove: (id: number) => void,
  ): DataTableColumn<number>[] => [
    {
      id: "principal",
      label: primaryLabel,
      primary: true,
      render: (id) => labelById.get(id) ?? fallbackLabel(id),
    },
    {
      id: "actions",
      label: text("actions"),
      align: "right",
      mobileRole: "actions",
      render: (id) => (
        <ListActions>
          <ListActionButton type="button" variant="danger" onClick={() => onRemove(id)}>
            {text("remove")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];
  const connectionColumns = simpleAssociationColumns(
    text("connection"),
    connections.labelById,
    (id) => text("connectionById", { id }),
    (id) =>
      connections.setSelected((current) =>
        current.filter((connectionId) => connectionId !== id),
      ),
  );
  const openStackColumns = openstack
    ? simpleAssociationColumns(
        text("cloud"),
        openstack.labelById,
        (id) => text("cloudById", { id }),
        (id) =>
          openstack.setSelected((current) =>
            current.filter((cloudId) => cloudId !== id),
          ),
      )
    : [];
  return (
    <AdminAssociationTabs
      tabs={[
        {
          id: "accounts",
          label: text("accounts"),
          count: accounts.selected.length,
          actionLabel: text(accounts.showPanel ? "close" : "addAccounts"),
          onAction: () => accounts.setShowPanel((current) => !current),
          content: (
            <UserAccountAssociationsPanel
              accounts={accounts}
              maxVisibleOptions={maxVisibleOptions}
              showPortalRole={showPortalRole}
            />
          ),
        },
        {
          id: "s3_users",
          label: text("s3Users"),
          count: s3Users.selected.length,
          actionLabel: text(s3Users.showPanel ? "close" : "addUsers"),
          onAction: () => s3Users.setShowPanel((current) => !current),
          content: (
            <div className="space-y-3">
              <DataTableShell
                columns={s3UserColumns}
                rows={s3Users.selected}
                rowKey={(entry) => entry.s3_user_id}
                status={s3Users.selected.length ? "ready" : "empty"}
                loadingMessage={text("loadingUsers")}
                errorMessage={text("noLinkedUser")}
                emptyMessage={text("noLinkedUser")}
                containerClassName={adminAssociationTableContainerClass}
                responsiveCards
              />
              {s3Users.showPanel ? (
                <AdminAssociationPickerPanel
                  title={text("addUsers")}
                  hint={text("searchByName")}
                  search={s3Users.search}
                  onSearchChange={s3Users.setSearch}
                  loading={s3Users.loading}
                  availableCount={s3Users.available.length}
                  maxVisibleOptions={maxVisibleOptions}
                  selectedCount={s3Users.selections.length}
                  loadingLabel={text("loadingUsers")}
                  addDisabled={s3Users.selections.length === 0}
                  onCancel={() => {
                    s3Users.setShowPanel(false);
                    s3Users.setSelections([]);
                    s3Users.setSearch("");
                  }}
                  onAdd={() => {
                    if (s3Users.selections.length === 0) return;
                    s3Users.setSelected((current) => [
                      ...current,
                      ...s3Users.selections.map((s3UserId) => ({
                        s3_user_id: s3UserId,
                        allow_manager_browser_data_access: false,
                      })),
                    ]);
                    s3Users.setSelections([]);
                    s3Users.setSearch("");
                    s3Users.setShowPanel(false);
                  }}
                >
                  <AdminAssociationCheckboxOptions
                    options={s3Users.visible}
                    selectedIds={s3Users.selections}
                    onToggle={s3Users.toggleSelection}
                    getLabel={(option) => option.label}
                  />
                </AdminAssociationPickerPanel>
              ) : null}
            </div>
          ),
        },
        {
          id: "connections",
          label: text("connections"),
          count: connections.selected.length,
          actionLabel: text(connections.showPanel ? "close" : "addConnections"),
          onAction: () => connections.setShowPanel((current) => !current),
          hint: text("sharedConnectionsOnly"),
          content: (
            <SimpleIdAssociationsPanel
              state={connections}
              columns={connectionColumns}
              maxVisibleOptions={maxVisibleOptions}
              loadingMessage={text("loadingConnections")}
              emptyMessage={text("noLinkedConnection")}
              pickerTitle={text("addConnections")}
              searchHint={text("searchByName")}
            />
          ),
        },
        ...(openstack ? [{
          id: "openstack",
          label: text("openStack"),
          count: openstack.selected.length,
          actionLabel: text(openstack.showPanel ? "close" : "addOpenStackClouds"),
          onAction: () => openstack.setShowPanel((current) => !current),
          content: (
            <SimpleIdAssociationsPanel
              state={openstack}
              columns={openStackColumns}
              maxVisibleOptions={maxVisibleOptions}
              loadingMessage={text("loadingOpenStackClouds")}
              emptyMessage={text("noLinkedOpenStackCloud")}
              pickerTitle={text("addOpenStackClouds")}
              searchHint={text("searchByName")}
            />
          ),
        }] : []),
      ]}
      activeTab={activeTab}
      onChange={(id) =>
        onTabChange(
          id === "s3_users"
            ? "s3_users"
            : id === "connections"
              ? "connections"
              : id === "openstack"
                ? "openstack"
                : "accounts",
        )
      }
    />
  );
}
