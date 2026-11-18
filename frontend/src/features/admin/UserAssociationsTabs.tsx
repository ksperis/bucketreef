/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3UserMembership } from "../../api/users";
import { defaultAccountAccessGrant, hasAccountAccessRole } from "../../api/accountAccess";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationAccessPickerTable,
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  resetAdminAssociationPicker,
} from "./AdminAssociationPicker";
import {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
import type { AdminRgwUserAccessAssociationsState } from "./AdminRgwUserAccessAssociationsPanel";
import type { AdminSimpleIdAssociationsState } from "./AdminSimpleIdAssociationsPanel";
import type { AdminAccountAssociationsState } from "./AdminAccountAssociationsPanel";
import AdminUnifiedAssociations, {
  type AdminUnifiedAssociationRow,
} from "./AdminUnifiedAssociations";
import { useUserI18n } from "./userMessage";
import type { StorageAssociationKind } from "./useAdminStorageAssociationEditorState";

type UserAssociationsTabsProps = {
  maxVisibleOptions: number;
  accountsEnabled?: boolean;
  s3UsersEnabled?: boolean;
  connectionsEnabled?: boolean;
  accounts: AdminAccountAssociationsState;
  s3Users: AdminRgwUserAccessAssociationsState<S3UserMembership>;
  connections: AdminSimpleIdAssociationsState;
  openstack?: AdminSimpleIdAssociationsState;
  onOpenPicker: (kind: StorageAssociationKind) => void;
  onEnsureOptions: (kind: StorageAssociationKind) => void;
};

export default function UserAssociationsTabs({
  maxVisibleOptions,
  accountsEnabled = true,
  s3UsersEnabled = true,
  connectionsEnabled = true,
  accounts,
  s3Users,
  connections,
  openstack,
  onOpenPicker,
  onEnsureOptions,
}: UserAssociationsTabsProps) {
  const { text } = useUserI18n();
  const { generalSettings } = useGeneralSettings();
  const defaultAccess = defaultAccountAccessGrant();
  const showManagerRole = generalSettings.managed_rgw_accounts_enabled;
  const showPortalRole =
    generalSettings.portal_enabled || accounts.selected.some((entry) => entry.portal_role);

  const accountRows: AdminUnifiedAssociationRow[] = accountsEnabled
    ? accounts.selected.map((entry) => {
        const label = accounts.optionsById.get(entry.id)?.name ?? text("accountById", { id: entry.id });
        const accessErrorId = `admin-account-access-${entry.id}-error`;
        const invalid = !hasAccountAccessRole(entry);
        return {
          key: `account-${entry.id}`,
          resource: (
            <>
              {label}
              <AccountAccessRoleValidationMessage id={accessErrorId} value={entry} />
            </>
          ),
          type: text("rgwAccount"),
          manager: showManagerRole ? (
            <ManagerAccountRoleSelect
              label={label}
              value={entry}
              onChange={(value) =>
                accounts.setSelected((current) =>
                  current.map((item) => item.id === entry.id ? { ...item, ...value } : item),
                )
              }
              showLabel={false}
              invalid={invalid}
              describedBy={invalid ? accessErrorId : undefined}
              fieldClassName="w-full md:w-48"
            />
          ) : null,
          portal: showPortalRole ? (
            <PortalAccountRoleSelect
              label={label}
              value={entry}
              onChange={(value) =>
                accounts.setSelected((current) =>
                  current.map((item) => item.id === entry.id ? { ...item, ...value } : item),
                )
              }
              showLabel={false}
              invalid={invalid}
              describedBy={invalid ? accessErrorId : undefined}
              fieldClassName="w-full md:w-44"
            />
          ) : null,
          actions: (
            <ListActions>
              {showManagerRole && entry.manager_role ? (
                <AdminAssociationAdvancedSettings
                  targetLabel={label}
                  associationKind="account"
                  allowManagerBrowserDataAccess={Boolean(entry.allow_manager_browser_data_access)}
                  onApply={(allowed) =>
                    accounts.setSelected((current) =>
                      current.map((item) => item.id === entry.id
                        ? { ...item, allow_manager_browser_data_access: allowed }
                        : item),
                    )
                  }
                />
              ) : null}
              <ListActionButton
                type="button"
                variant="danger"
                onClick={() =>
                  accounts.setSelected((current) => current.filter((item) => item.id !== entry.id))
                }
              >
                {text("remove")}
              </ListActionButton>
            </ListActions>
          ),
        };
      })
    : [];

  const s3UserRows: AdminUnifiedAssociationRow[] = s3UsersEnabled
    ? s3Users.selected.map((entry) => {
        const id = s3Users.adapter.getId(entry);
        const label = s3Users.labelById.get(id) ?? text("userById", { id });
        return {
          key: `rgw-user-${id}`,
          resource: label,
          type: text("rgwUser"),
          manager: text(entry.allow_manager_browser_data_access ? "browserDataEnabled" : "browserDataDisabled"),
          actions: (
            <ListActions>
              <AdminAssociationAdvancedSettings
                targetLabel={label}
                associationKind="rgw_user"
                allowManagerBrowserDataAccess={Boolean(entry.allow_manager_browser_data_access)}
                onApply={(allowed) =>
                  s3Users.setSelected((current) =>
                    current.map((item) => s3Users.adapter.getId(item) === id
                      ? s3Users.adapter.withAccess(item, allowed)
                      : item),
                  )
                }
              />
              <ListActionButton
                type="button"
                variant="danger"
                onClick={() =>
                  s3Users.setSelected((current) =>
                    current.filter((item) => s3Users.adapter.getId(item) !== id),
                  )
                }
              >
                {text("remove")}
              </ListActionButton>
            </ListActions>
          ),
        };
      })
    : [];

  const connectionRows: AdminUnifiedAssociationRow[] = connectionsEnabled
    ? connections.selected.map((id) => ({
        key: `connection-${id}`,
        resource: connections.labelById.get(id) ?? text("connectionById", { id }),
        type: text("s3Connection"),
        manager: text("enabled"),
        actions: (
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() =>
              connections.setSelected((current) => current.filter((selectedId) => selectedId !== id))
            }
          >
            {text("remove")}
          </ListActionButton>
        ),
      }))
    : [];

  const openStackRows: AdminUnifiedAssociationRow[] = openstack
    ? openstack.selected.map((id) => ({
        key: `openstack-${id}`,
        resource: openstack.labelById.get(id) ?? text("cloudById", { id }),
        type: text("openStackCloud"),
        manager: text("openStackAccess"),
        actions: (
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() =>
              openstack.setSelected((current) => current.filter((selectedId) => selectedId !== id))
            }
          >
            {text("remove")}
          </ListActionButton>
        ),
      }))
    : [];

  const open = (kind: StorageAssociationKind) => {
    onOpenPicker(kind);
    onEnsureOptions(kind);
  };

  let picker = null;
  if (accountsEnabled && accounts.showPanel) {
    const invalidSelection = accounts.selections.some(
      (id) => !hasAccountAccessRole(accounts.accountAccessChoice[id] ?? defaultAccess),
    );
    picker = (
      <AdminAssociationPickerPanel
        title={text("addRgwAccounts")}
        hint={text("searchByName")}
        search={accounts.search}
        onSearchChange={accounts.setSearch}
        loading={accounts.loading}
        availableCount={accounts.available.length}
        maxVisibleOptions={maxVisibleOptions}
        selectedCount={accounts.selections.length}
        loadingLabel={text("loadingAccounts")}
        pagination={accounts.pagination}
        addDisabled={accounts.selections.length === 0 || invalidSelection}
        onCancel={() => resetAdminAssociationPicker(accounts)}
        onAdd={() => {
          if (!accounts.selections.length || invalidSelection) return;
          const next = accounts.selections.map((id) => ({
            id,
            ...(accounts.accountAccessChoice[id] ?? defaultAccess),
            allow_manager_browser_data_access: false,
          }));
          accounts.setSelected((current) => [...current, ...next]);
          resetAdminAssociationPicker(accounts);
        }}
      >
        <AdminAssociationAccessPickerTable
          title={text("availableAccounts")}
          principalLabel={text("account")}
          options={accounts.visible.map((option) => ({
            id: option.id,
            label: option.label,
            selected: accounts.selections.includes(option.id),
            access: accounts.accountAccessChoice[option.id] ?? defaultAccess,
          }))}
          onToggle={accounts.toggleSelection}
          onAccessChange={(id, access) =>
            accounts.setAccountAccessChoice((current) => ({ ...current, [id]: access }))
          }
        />
      </AdminAssociationPickerPanel>
    );
  } else if (s3UsersEnabled && s3Users.showPanel) {
    picker = (
      <AdminAssociationPickerPanel
        title={text("addRgwUsers")}
        hint={text("searchByName")}
        search={s3Users.search}
        onSearchChange={s3Users.setSearch}
        loading={s3Users.loading}
        availableCount={s3Users.available.length}
        maxVisibleOptions={maxVisibleOptions}
        selectedCount={s3Users.selections.length}
        loadingLabel={text("loadingUsers")}
        pagination={s3Users.pagination}
        addDisabled={s3Users.selections.length === 0}
        onCancel={() => resetAdminAssociationPicker(s3Users)}
        onAdd={() => {
          if (!s3Users.selections.length) return;
          s3Users.setSelected((current) => [
            ...current,
            ...s3Users.selections.map(s3Users.adapter.createLink),
          ]);
          resetAdminAssociationPicker(s3Users);
        }}
      >
        <AdminAssociationCheckboxOptions
          options={s3Users.visible}
          selectedIds={s3Users.selections}
          onToggle={s3Users.toggleSelection}
          getLabel={(option) => option.label}
        />
      </AdminAssociationPickerPanel>
    );
  } else if (connectionsEnabled && connections.showPanel) {
    picker = (
      <AdminAssociationPickerPanel
        title={text("addS3Connections")}
        hint={text("sharedConnectionsOnly")}
        search={connections.search}
        onSearchChange={connections.setSearch}
        loading={connections.loading}
        availableCount={connections.available.length}
        maxVisibleOptions={maxVisibleOptions}
        selectedCount={connections.selections.length}
        loadingLabel={text("loadingConnections")}
        pagination={connections.pagination}
        addDisabled={connections.selections.length === 0}
        onCancel={() => resetAdminAssociationPicker(connections)}
        onAdd={() => {
          if (!connections.selections.length) return;
          connections.setSelected((current) => [...new Set([...current, ...connections.selections])]);
          resetAdminAssociationPicker(connections);
        }}
      >
        <AdminAssociationCheckboxOptions
          options={connections.visible}
          selectedIds={connections.selections}
          onToggle={connections.toggleSelection}
          getLabel={(option) => option.label}
        />
      </AdminAssociationPickerPanel>
    );
  } else if (openstack?.showPanel) {
    picker = (
      <AdminAssociationPickerPanel
        title={text("addOpenStackClouds")}
        hint={text("searchByName")}
        search={openstack.search}
        onSearchChange={openstack.setSearch}
        loading={openstack.loading}
        availableCount={openstack.available.length}
        maxVisibleOptions={maxVisibleOptions}
        selectedCount={openstack.selections.length}
        loadingLabel={text("loadingOpenStackClouds")}
        pagination={openstack.pagination}
        addDisabled={openstack.selections.length === 0}
        onCancel={() => resetAdminAssociationPicker(openstack)}
        onAdd={() => {
          if (!openstack.selections.length) return;
          openstack.setSelected((current) => [...new Set([...current, ...openstack.selections])]);
          resetAdminAssociationPicker(openstack);
        }}
      >
        <AdminAssociationCheckboxOptions
          options={openstack.visible}
          selectedIds={openstack.selections}
          onToggle={openstack.toggleSelection}
          getLabel={(option) => option.label}
        />
      </AdminAssociationPickerPanel>
    );
  }

  const rows = [...accountRows, ...s3UserRows, ...connectionRows, ...openStackRows];
  return (
    <AdminUnifiedAssociations
      title={text("resourceAccess")}
      rows={rows}
      resourceLabel={text("resource")}
      typeLabel={text("type")}
      managerLabel={text("manager")}
      portalLabel={text("portal")}
      actionsLabel={text("actions")}
      emptyMessage={text("noResourceAccess")}
      countLabel={text("linkedCount", { count: rows.length })}
      addActions={[
        ...(accountsEnabled ? [{ key: "accounts", label: text("addRgwAccounts"), onAction: () => open("accounts") }] : []),
        ...(s3UsersEnabled ? [{ key: "s3-users", label: text("addRgwUsers"), onAction: () => open("s3_users") }] : []),
        ...(connectionsEnabled ? [{ key: "connections", label: text("addS3Connections"), onAction: () => open("connections") }] : []),
        ...(openstack ? [{ key: "openstack", label: text("addOpenStackClouds"), onAction: () => open("openstack") }] : []),
      ]}
      picker={picker}
    />
  );
}
