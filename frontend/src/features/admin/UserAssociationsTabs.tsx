/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import type { Dispatch, SetStateAction } from "react";
import type { S3UserMembership } from "../../api/users";

import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import { AdminAssociationCheckboxOptions, AdminAssociationPickerPanel, AdminAssociationTabs, adminAssociationTableContainerClass } from "./AdminAssociationPicker";
import UserAccountAssociationsPanel, {
  type UserAccountAssociationsState,
} from "./UserAccountAssociationsPanel";

export type AssociationTab = "accounts" | "s3_users" | "connections";

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

type ConnectionAssociationsState = {
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
  activeTab: AssociationTab;
  onTabChange: (tab: AssociationTab) => void;
  maxVisibleOptions: number;
  showPortalRole: boolean;
  accounts: UserAccountAssociationsState;
  s3Users: S3UserAssociationsState;
  connections: ConnectionAssociationsState;
};

export default function UserAssociationsTabs({
  activeTab,
  onTabChange,
  maxVisibleOptions,
  showPortalRole,
  accounts,
  s3Users,
  connections,
}: UserAssociationsTabsProps) {
  return (
    <AdminAssociationTabs
      tabs={[
        {
          id: "accounts",
          label: "Accounts",
          count: accounts.selected.length,
          actionLabel: accounts.showPanel ? "Close" : "Add accounts",
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
          label: "S3 Users",
          count: s3Users.selected.length,
          actionLabel: s3Users.showPanel ? "Close" : "Add users",
          onAction: () => s3Users.setShowPanel((current) => !current),
          content: (
            <div className="space-y-3">
              <div className={adminAssociationTableContainerClass}>
                <table className="ui-data-table">
                  <thead>
                    <tr>
                      <th className="text-left">User</th>
                      <th className="w-px whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s3Users.selected.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="ui-table-secondary">
                          No user linked yet.
                        </td>
                      </tr>
                    ) : (
                      s3Users.selected.map((entry) => {
                        const label =
                          s3Users.labelById.get(entry.s3_user_id) ??
                          `User #${entry.s3_user_id}`;
                        return (
                          <tr key={entry.s3_user_id}>
                            <td className="ui-table-primary">{label}</td>
                            <td className="ui-table-actions-cell w-px text-right">
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
                                    current.filter(
                                      (item) => item.s3_user_id !== entry.s3_user_id,
                                    ),
                                  )
                                }
                                 variant="danger"
                              >
                                Remove
                              </ListActionButton>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {s3Users.showPanel ? (
                <AdminAssociationPickerPanel
                  title="Add users"
                  hint="(search by name)"
                  search={s3Users.search}
                  onSearchChange={s3Users.setSearch}
                  loading={s3Users.loading}
                  availableCount={s3Users.available.length}
                  maxVisibleOptions={maxVisibleOptions}
                  selectedCount={s3Users.selections.length}
                  loadingLabel="Loading users..."
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
          label: "Connections",
          count: connections.selected.length,
          actionLabel: connections.showPanel ? "Close" : "Add connections",
          onAction: () => connections.setShowPanel((current) => !current),
          hint: "Shared connections only",
          content: (
            <div className="space-y-3">
              <div className={adminAssociationTableContainerClass}>
                <table className="ui-data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Connection</th>
                      <th className="w-px whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.selected.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="ui-table-secondary">
                          No connection linked yet.
                        </td>
                      </tr>
                    ) : (
                      connections.selected.map((id) => (
                        <tr key={id}>
                          <td className="ui-table-primary">
                            {connections.labelById.get(id) ?? `Connection #${id}`}
                          </td>
                          <td className="ui-table-actions-cell w-px text-right">
                            <ListActionButton
                              type="button"
                              onClick={() =>
                                connections.setSelected((current) =>
                                  current.filter((connectionId) => connectionId !== id),
                                )
                              }
                               variant="danger"
                            >
                              Remove
                            </ListActionButton>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {connections.showPanel ? (
                <AdminAssociationPickerPanel
                  title="Add connections"
                  hint="(search by name)"
                  search={connections.search}
                  onSearchChange={connections.setSearch}
                  loading={connections.loading}
                  availableCount={connections.available.length}
                  maxVisibleOptions={maxVisibleOptions}
                  selectedCount={connections.selections.length}
                  loadingLabel="Loading connections..."
                  addDisabled={connections.selections.length === 0}
                  onCancel={() => {
                    connections.setShowPanel(false);
                    connections.setSelections([]);
                    connections.setSearch("");
                  }}
                  onAdd={() => {
                    if (connections.selections.length === 0) return;
                    connections.setSelected((current) => [
                      ...current,
                      ...connections.selections,
                    ]);
                    connections.setSelections([]);
                    connections.setSearch("");
                    connections.setShowPanel(false);
                  }}
                >
                  <AdminAssociationCheckboxOptions
                    options={connections.visible}
                    selectedIds={connections.selections}
                    onToggle={connections.toggleSelection}
                    getLabel={(option) => option.label}
                  />
                </AdminAssociationPickerPanel>
              ) : null}
            </div>
          ),
        },
      ]}
      activeTab={activeTab}
      onChange={(id) =>
        onTabChange(
          id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts",
        )
      }
    />
  );
}
