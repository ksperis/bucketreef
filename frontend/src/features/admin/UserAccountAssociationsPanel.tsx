/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import type { Dispatch, SetStateAction } from "react";
import {
  defaultAccountAccessGrant,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import type { S3AccountSummary } from "../../api/accounts";

import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
import { AdminAssociationAccessPickerTable, AdminAssociationPickerPanel, adminAssociationTableContainerClass } from "./AdminAssociationPicker";
import { useUserI18n } from "./userMessage";

export type AccountSelection = AccountAccessGrant & {
  id: number;
};

type AccountOption = {
  id: number;
  label: string;
};

export type UserAccountAssociationsState = {
  selected: AccountSelection[];
  setSelected: Dispatch<SetStateAction<AccountSelection[]>>;
  optionsById: Map<number, S3AccountSummary>;
  available: AccountOption[];
  visible: AccountOption[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  loading: boolean;
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
  accountAccessChoice: Record<number, AccountAccessGrant>;
  setAccountAccessChoice: Dispatch<SetStateAction<Record<number, AccountAccessGrant>>>;
  toggleSelection: (id: number) => void;
};

type UserAccountAssociationsPanelProps = {
  accounts: UserAccountAssociationsState;
  maxVisibleOptions: number;
  showPortalRole: boolean;
};

export default function UserAccountAssociationsPanel({
  accounts,
  maxVisibleOptions,
  showPortalRole,
}: UserAccountAssociationsPanelProps) {
  const { text } = useUserI18n();
  const defaultAccess = defaultAccountAccessGrant(showPortalRole);
  const hasInvalidPendingSelection = accounts.selections.some(
    (accountId) =>
      !hasAccountAccessRole(accounts.accountAccessChoice[accountId] ?? defaultAccess),
  );
  const showPortalColumn = showPortalRole;
  const columns: DataTableColumn<AccountSelection>[] = [
    {
      id: "account",
      label: text("account"),
      primary: true,
      render: (entry) => {
        const label =
          accounts.optionsById.get(Number(entry.id))?.name ??
          text("accountById", { id: entry.id });
        const accessErrorId = `user-account-access-${entry.id}-error`;
        return (
          <>
            {label}
            <AccountAccessRoleValidationMessage
              id={accessErrorId}
              value={entry}
              portalEnabled={showPortalRole}
            />
          </>
        );
      },
    },
    {
      id: "manager-role",
      label: text("managerRole"),
      render: (entry) => {
        const label =
          accounts.optionsById.get(Number(entry.id))?.name ??
          text("accountById", { id: entry.id });
        const accessErrorId = `user-account-access-${entry.id}-error`;
        const invalid = !hasAccountAccessRole(entry);
        return (
          <ManagerAccountRoleSelect
            label={label}
            portalEnabled={showPortalRole}
            value={entry}
            onChange={(value) =>
              accounts.setSelected((current) =>
                current.map((item) =>
                  item.id === entry.id ? { ...item, ...value } : item,
                ),
              )
            }
            showLabel={false}
            invalid={invalid}
            describedBy={invalid ? accessErrorId : undefined}
          />
        );
      },
    },
    ...(showPortalColumn
      ? [{
          id: "portal-role",
          label: text("portalRole"),
          render: (entry: AccountSelection) => {
            const label =
              accounts.optionsById.get(Number(entry.id))?.name ??
              text("accountById", { id: entry.id });
            const accessErrorId = `user-account-access-${entry.id}-error`;
            const invalid = !hasAccountAccessRole(entry);
            return (
              <PortalAccountRoleSelect
                label={label}
                portalEnabled={showPortalRole}
                value={entry}
                onChange={(value) =>
                  accounts.setSelected((current) =>
                    current.map((item) =>
                      item.id === entry.id ? { ...item, ...value } : item,
                    ),
                  )
                }
                showLabel={false}
                invalid={invalid}
                describedBy={invalid ? accessErrorId : undefined}
              />
            );
          },
        } satisfies DataTableColumn<AccountSelection>]
      : []),
    {
      id: "actions",
      label: text("actions"),
      align: "right",
      mobileRole: "actions",
      render: (entry) => {
        const label =
          accounts.optionsById.get(Number(entry.id))?.name ??
          text("accountById", { id: entry.id });
        return (
          <ListActions>
            {entry.manager_role ? (
              <AdminAssociationAdvancedSettings
                targetLabel={label}
                associationKind="account"
                allowManagerBrowserDataAccess={Boolean(
                  entry.allow_manager_browser_data_access,
                )}
                onApply={(allowed) =>
                  accounts.setSelected((current) =>
                    current.map((item) =>
                      item.id === entry.id
                        ? {
                            ...item,
                            allow_manager_browser_data_access: allowed,
                          }
                        : item,
                    ),
                  )
                }
              />
            ) : null}
            <ListActionButton
              type="button"
              onClick={() =>
                accounts.setSelected((current) =>
                  current.filter((account) => account.id !== entry.id),
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

  return (
    <div className="space-y-3">
      <DataTableShell
        columns={columns}
        rows={accounts.selected}
        rowKey={(entry) => entry.id}
        status={accounts.selected.length ? "ready" : "empty"}
        loadingMessage={text("loadingAccounts")}
        errorMessage={text("noLinkedAccount")}
        emptyMessage={text("noLinkedAccount")}
        containerClassName={adminAssociationTableContainerClass}
        responsiveCards
      />
      {accounts.showPanel ? (
        <AdminAssociationPickerPanel
          title={text("addAccounts")}
          hint={text("searchByName")}
          search={accounts.search}
          onSearchChange={accounts.setSearch}
          loading={accounts.loading}
          availableCount={accounts.available.length}
          maxVisibleOptions={maxVisibleOptions}
          selectedCount={accounts.selections.length}
          loadingLabel={text("loadingAccounts")}
          addDisabled={accounts.selections.length === 0 || hasInvalidPendingSelection}
          onCancel={() => {
            accounts.setShowPanel(false);
            accounts.setSelections([]);
            accounts.setSearch("");
          }}
          onAdd={() => {
            if (accounts.selections.length === 0) return;
            const next = accounts.selections.map((accountId) => ({
              id: accountId,
              ...(accounts.accountAccessChoice[accountId] ?? defaultAccess),
              allow_manager_browser_data_access: false,
            }));
            accounts.setSelected((current) => [...current, ...next]);
            accounts.setSelections([]);
            accounts.setSearch("");
            accounts.setShowPanel(false);
          }}
        >
          <AdminAssociationAccessPickerTable
            title={text("availableAccounts")}
            principalLabel={text("account")}
            options={accounts.visible.map((option) => {
              const accountId = Number(option.id);
              return {
                id: accountId,
                label: option.label,
                selected: accounts.selections.includes(accountId),
                access: accounts.accountAccessChoice[accountId] ?? defaultAccess,
              };
            })}
            portalEnabled={showPortalRole}
            onToggle={accounts.toggleSelection}
            onAccessChange={(accountId, value) =>
              accounts.setAccountAccessChoice((current) => ({
                ...current,
                [accountId]: value,
              }))
            }
          />
        </AdminAssociationPickerPanel>
      ) : null}
    </div>
  );
}
