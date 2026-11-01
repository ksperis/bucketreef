/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3UserMembership } from "../../api/users";
import { AdminAssociationTabs } from "./AdminAssociationPicker";
import AdminRgwUserAccessAssociationsPanel, {
  type AdminRgwUserAccessAssociationsState,
} from "./AdminRgwUserAccessAssociationsPanel";
import AdminSimpleIdAssociationsPanel, {
  type AdminSimpleIdAssociationsState,
} from "./AdminSimpleIdAssociationsPanel";
import AdminAccountAssociationsPanel, {
  type AdminAccountAssociationsState,
} from "./AdminAccountAssociationsPanel";
import { useUserI18n } from "./userMessage";
import type { StorageAssociationTab } from "./useAdminStorageAssociationEditorState";

type UserAssociationsTabsProps = {
  activeTab: StorageAssociationTab;
  onTabChange: (tab: StorageAssociationTab) => void;
  maxVisibleOptions: number;
  showPortalRole: boolean;
  accounts: AdminAccountAssociationsState;
  s3Users: AdminRgwUserAccessAssociationsState<S3UserMembership>;
  connections: AdminSimpleIdAssociationsState;
  openstack?: AdminSimpleIdAssociationsState;
};

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
            <AdminAccountAssociationsPanel
              accounts={accounts}
              maxVisibleOptions={maxVisibleOptions}
              showPortalRole={showPortalRole}
              labels={{
                account: text("account"),
                managerRole: text("managerRole"),
                portalRole: text("portalRole"),
                actions: text("actions"),
                remove: text("remove"),
                loading: text("loadingAccounts"),
                empty: text("noLinkedAccount"),
                pickerTitle: text("addAccounts"),
                searchHint: text("searchByName"),
                availableTitle: text("availableAccounts"),
                fallbackLabel: (id) => text("accountById", { id }),
              }}
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
            <AdminRgwUserAccessAssociationsPanel
              state={s3Users}
              maxVisibleOptions={maxVisibleOptions}
              primaryLabel={text("user")}
              actionsLabel={text("actions")}
              removeLabel={text("remove")}
              loadingMessage={text("loadingUsers")}
              emptyMessage={text("noLinkedUser")}
              pickerTitle={text("addUsers")}
              searchHint={text("searchByName")}
              fallbackLabel={(id) => text("userById", { id })}
            />
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
            <AdminSimpleIdAssociationsPanel
              state={connections}
              maxVisibleOptions={maxVisibleOptions}
              primaryLabel={text("connection")}
              actionsLabel={text("actions")}
              removeLabel={text("remove")}
              loadingMessage={text("loadingConnections")}
              emptyMessage={text("noLinkedConnection")}
              pickerTitle={text("addConnections")}
              searchHint={text("searchByName")}
              fallbackLabel={(id) => text("connectionById", { id })}
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
            <AdminSimpleIdAssociationsPanel
              state={openstack}
              maxVisibleOptions={maxVisibleOptions}
              primaryLabel={text("cloud")}
              actionsLabel={text("actions")}
              removeLabel={text("remove")}
              loadingMessage={text("loadingOpenStackClouds")}
              emptyMessage={text("noLinkedOpenStackCloud")}
              pickerTitle={text("addOpenStackClouds")}
              searchHint={text("searchByName")}
              fallbackLabel={(id) => text("cloudById", { id })}
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
