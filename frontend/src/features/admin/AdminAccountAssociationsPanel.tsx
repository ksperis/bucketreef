/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";

import {
  defaultAccountAccessGrant,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import type { S3AccountSummary } from "../../api/accounts";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationAccessPickerTable,
  AdminAssociationPickerPanel,
  adminAssociationTableContainerClass,
} from "./AdminAssociationPicker";
import {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
import type { AdminSimpleAssociationOption } from "./AdminSimpleIdAssociationsPanel";

export type AdminAccountSelection = AccountAccessGrant & {
  id: number;
};

export type AdminAccountAssociationsState = {
  selected: AdminAccountSelection[];
  setSelected: Dispatch<SetStateAction<AdminAccountSelection[]>>;
  optionsById: Map<number, S3AccountSummary>;
  available: AdminSimpleAssociationOption[];
  visible: AdminSimpleAssociationOption[];
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

type AdminAccountAssociationsLabels = {
  account: string;
  managerRole: string;
  portalRole: string;
  actions: string;
  remove: string;
  loading: string;
  empty: string;
  pickerTitle: string;
  searchHint: string;
  availableTitle: string;
  fallbackLabel: (id: number) => string;
  searchAriaLabel?: string;
  pickerEmptyMessage?: string;
};

type AdminAccountAssociationsPanelProps = {
  accounts: AdminAccountAssociationsState;
  maxVisibleOptions: number;
  showPortalRole: boolean;
  labels: AdminAccountAssociationsLabels;
  normalizeSelection?: (links: AdminAccountSelection[]) => AdminAccountSelection[];
};

export default function AdminAccountAssociationsPanel({
  accounts,
  maxVisibleOptions,
  showPortalRole,
  labels,
  normalizeSelection = (links) => links,
}: AdminAccountAssociationsPanelProps) {
  const defaultAccess = defaultAccountAccessGrant(showPortalRole);
  const hasInvalidPendingSelection = accounts.selections.some(
    (accountId) =>
      !hasAccountAccessRole(accounts.accountAccessChoice[accountId] ?? defaultAccess),
  );
  const columns: DataTableColumn<AdminAccountSelection>[] = [
    {
      id: "account",
      label: labels.account,
      primary: true,
      render: (entry) => {
        const label =
          accounts.optionsById.get(entry.id)?.name ?? labels.fallbackLabel(entry.id);
        const accessErrorId = `admin-account-access-${entry.id}-error`;
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
      label: labels.managerRole,
      render: (entry) => {
        const label =
          accounts.optionsById.get(entry.id)?.name ?? labels.fallbackLabel(entry.id);
        const accessErrorId = `admin-account-access-${entry.id}-error`;
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
    ...(showPortalRole
      ? [{
          id: "portal-role",
          label: labels.portalRole,
          render: (entry: AdminAccountSelection) => {
            const label =
              accounts.optionsById.get(entry.id)?.name ?? labels.fallbackLabel(entry.id);
            const accessErrorId = `admin-account-access-${entry.id}-error`;
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
        } satisfies DataTableColumn<AdminAccountSelection>]
      : []),
    {
      id: "actions",
      label: labels.actions,
      align: "right",
      mobileRole: "actions",
      render: (entry) => {
        const label =
          accounts.optionsById.get(entry.id)?.name ?? labels.fallbackLabel(entry.id);
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
              variant="danger"
              onClick={() =>
                accounts.setSelected((current) =>
                  current.filter((account) => account.id !== entry.id),
                )
              }
            >
              {labels.remove}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  const resetPicker = () => {
    accounts.setShowPanel(false);
    accounts.setSelections([]);
    accounts.setSearch("");
  };

  return (
    <div className="space-y-3">
      <DataTableShell
        columns={columns}
        rows={accounts.selected}
        rowKey={(entry) => entry.id}
        status={accounts.selected.length ? "ready" : "empty"}
        loadingMessage={labels.loading}
        errorMessage={labels.empty}
        emptyMessage={labels.empty}
        containerClassName={adminAssociationTableContainerClass}
        responsiveCards
      />
      {accounts.showPanel ? (
        <AdminAssociationPickerPanel
          title={labels.pickerTitle}
          hint={labels.searchHint}
          search={accounts.search}
          onSearchChange={accounts.setSearch}
          searchAriaLabel={labels.searchAriaLabel}
          loading={accounts.loading}
          availableCount={accounts.available.length}
          maxVisibleOptions={maxVisibleOptions}
          selectedCount={accounts.selections.length}
          loadingLabel={labels.loading}
          emptyLabel={labels.pickerEmptyMessage}
          addDisabled={accounts.selections.length === 0 || hasInvalidPendingSelection}
          onCancel={resetPicker}
          onAdd={() => {
            if (accounts.selections.length === 0) return;
            const next = accounts.selections.map((accountId) => ({
              id: accountId,
              ...(accounts.accountAccessChoice[accountId] ?? defaultAccess),
              allow_manager_browser_data_access: false,
            }));
            accounts.setSelected((current) => normalizeSelection([...current, ...next]));
            resetPicker();
          }}
        >
          <AdminAssociationAccessPickerTable
            title={labels.availableTitle}
            principalLabel={labels.account}
            options={accounts.visible.map((option) => {
              const accountId = option.id;
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
