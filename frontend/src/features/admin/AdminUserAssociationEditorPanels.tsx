/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSummary } from "../../api/accounts";
import type { UiGroupSummary } from "../../api/groups";
import UserAssociationsTabs from "./UserAssociationsTabs";
import UserGroupsSelector from "./UserGroupsSelector";
import type { AdminUserAssociationDerivedOptions } from "./useAdminUserAssociationDerivedOptions";
import { MAX_VISIBLE_ASSOCIATION_OPTIONS } from "./adminAssociationOptions";
import type { AdminUserAssociationEditorState } from "./useAdminUserAssociationEditorState";
import type { StorageAssociationTab } from "./useAdminStorageAssociationEditorState";

export type AdminUserAssociationEditorResources = {
  accountOptionsById: Map<number, S3AccountSummary>;
  s3UserLabelById: Map<number, string>;
  s3ConnectionLabelById: Map<number, string>;
  openStackLabelById: Map<number, string>;
  groups: UiGroupSummary[];
  groupsLoaded: boolean;
  groupsLoading: boolean;
  s3AccountsLoading: boolean;
  s3UsersLoading: boolean;
  s3ConnectionsLoading: boolean;
  openStackCloudsLoading: boolean;
  accountCatalog: {
    search: string;
    setSearch: (value: string) => void;
    page: number;
    pageSize: number;
    total: number;
    setPage: (page: number) => void;
    setPageSize: (pageSize: number) => void;
  };
  s3UserCatalog: {
    search: string;
    setSearch: (value: string) => void;
    page: number;
    pageSize: number;
    total: number;
    setPage: (page: number) => void;
    setPageSize: (pageSize: number) => void;
  };
  s3ConnectionCatalog: {
    search: string;
    setSearch: (value: string) => void;
    page: number;
    pageSize: number;
    total: number;
    setPage: (page: number) => void;
    setPageSize: (pageSize: number) => void;
  };
  openStackCatalog: {
    search: string;
    setSearch: (value: string) => void;
    page: number;
    pageSize: number;
    total: number;
    setPage: (page: number) => void;
    setPageSize: (pageSize: number) => void;
  };
  groupCatalog: {
    search: string;
    setSearch: (value: string) => void;
    page: number;
    pageSize: number;
    total: number;
    setPage: (page: number) => void;
    setPageSize: (pageSize: number) => void;
  };
  showPortalRole: boolean;
  openStackEnabled: boolean;
  ensureAssociationOptionsForTab: (
    tab: StorageAssociationTab,
    options?: { retryOnError?: boolean },
  ) => Promise<void>;
};

type AdminUserAssociationEditorPanelsProps = {
  panel: "associations" | "groups";
  editor: AdminUserAssociationEditorState;
  options: AdminUserAssociationDerivedOptions;
  resources: AdminUserAssociationEditorResources;
};

export default function AdminUserAssociationEditorPanels({
  panel,
  editor,
  options,
  resources,
}: AdminUserAssociationEditorPanelsProps) {
  if (panel === "groups") {
    return (
      <UserGroupsSelector
        groups={resources.groups}
        groupsLoaded={resources.groupsLoaded}
        groupsLoading={resources.groupsLoading}
        maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
        selectedIds={editor.groups.selected}
        setSelectedIds={editor.groups.setSelected}
        search={editor.groups.picker.search}
        setSearch={(value) => {
          editor.groups.picker.setSearch(value);
          resources.groupCatalog.setSearch(value);
        }}
        visibleGroups={options.groups}
        showPanel={editor.groups.picker.open}
        setShowPanel={editor.groups.picker.setOpen}
        selections={editor.groups.picker.selections}
        setSelections={editor.groups.picker.setSelections}
        pagination={{
          page: resources.groupCatalog.page,
          pageSize: resources.groupCatalog.pageSize,
          total: resources.groupCatalog.total,
          onPageChange: resources.groupCatalog.setPage,
          onPageSizeChange: resources.groupCatalog.setPageSize,
        }}
      />
    );
  }

  return (
    <UserAssociationsTabs
      activeTab={editor.tab}
      onTabChange={(nextTab) => {
        const tabChanged = nextTab !== editor.tab;
        editor.setTab(nextTab);
        editor.closePickers();
        if (tabChanged) {
          void resources.ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
        }
      }}
      maxVisibleOptions={MAX_VISIBLE_ASSOCIATION_OPTIONS}
      showPortalRole={resources.showPortalRole}
      accounts={{
        selected: editor.accounts.selected,
        setSelected: editor.accounts.setSelected,
        optionsById: resources.accountOptionsById,
        available: options.accounts.available,
        visible: options.accounts.visible,
        search: editor.accounts.picker.search,
        setSearch: (value) => {
          editor.accounts.picker.setSearch(value);
          resources.accountCatalog.setSearch(value);
        },
        loading: resources.s3AccountsLoading,
        showPanel: editor.accounts.picker.open,
        setShowPanel: editor.accounts.picker.setOpen,
        selections: editor.accounts.picker.selections,
        setSelections: editor.accounts.picker.setSelections,
        accountAccessChoice: editor.accounts.accessChoice,
        setAccountAccessChoice: editor.accounts.setAccessChoice,
        toggleSelection: editor.accounts.picker.toggleSelection,
        pagination: {
          page: resources.accountCatalog.page,
          pageSize: resources.accountCatalog.pageSize,
          total: resources.accountCatalog.total,
          onPageChange: resources.accountCatalog.setPage,
          onPageSizeChange: resources.accountCatalog.setPageSize,
        },
      }}
      s3Users={{
        selected: editor.s3Users.selected,
        setSelected: editor.s3Users.setSelected,
        getId: (link) => link.s3_user_id,
        createLink: (id) => ({
          s3_user_id: id,
          allow_manager_browser_data_access: false,
        }),
        withAccess: (link, allowed) => ({
          ...link,
          allow_manager_browser_data_access: allowed,
        }),
        labelById: resources.s3UserLabelById,
        available: options.s3Users.available,
        visible: options.s3Users.visible,
        search: editor.s3Users.picker.search,
        setSearch: (value) => {
          editor.s3Users.picker.setSearch(value);
          resources.s3UserCatalog.setSearch(value);
        },
        loading: resources.s3UsersLoading,
        showPanel: editor.s3Users.picker.open,
        setShowPanel: editor.s3Users.picker.setOpen,
        selections: editor.s3Users.picker.selections,
        setSelections: editor.s3Users.picker.setSelections,
        toggleSelection: editor.s3Users.picker.toggleSelection,
        pagination: {
          page: resources.s3UserCatalog.page,
          pageSize: resources.s3UserCatalog.pageSize,
          total: resources.s3UserCatalog.total,
          onPageChange: resources.s3UserCatalog.setPage,
          onPageSizeChange: resources.s3UserCatalog.setPageSize,
        },
      }}
      connections={{
        selected: editor.connections.selected,
        setSelected: editor.connections.setSelected,
        labelById: resources.s3ConnectionLabelById,
        available: options.connections.available,
        visible: options.connections.visible,
        search: editor.connections.picker.search,
        setSearch: (value) => {
          editor.connections.picker.setSearch(value);
          resources.s3ConnectionCatalog.setSearch(value);
        },
        loading: resources.s3ConnectionsLoading,
        showPanel: editor.connections.picker.open,
        setShowPanel: editor.connections.picker.setOpen,
        selections: editor.connections.picker.selections,
        setSelections: editor.connections.picker.setSelections,
        toggleSelection: editor.connections.picker.toggleSelection,
        pagination: {
          page: resources.s3ConnectionCatalog.page,
          pageSize: resources.s3ConnectionCatalog.pageSize,
          total: resources.s3ConnectionCatalog.total,
          onPageChange: resources.s3ConnectionCatalog.setPage,
          onPageSizeChange: resources.s3ConnectionCatalog.setPageSize,
        },
      }}
      openstack={resources.openStackEnabled ? {
        selected: editor.openStack.selected,
        setSelected: editor.openStack.setSelected,
        labelById: resources.openStackLabelById,
        available: options.openStack.available,
        visible: options.openStack.visible,
        search: editor.openStack.picker.search,
        setSearch: (value) => {
          editor.openStack.picker.setSearch(value);
          resources.openStackCatalog.setSearch(value);
        },
        loading: resources.openStackCloudsLoading,
        showPanel: editor.openStack.picker.open,
        setShowPanel: editor.openStack.picker.setOpen,
        selections: editor.openStack.picker.selections,
        setSelections: editor.openStack.picker.setSelections,
        toggleSelection: editor.openStack.picker.toggleSelection,
        pagination: {
          page: resources.openStackCatalog.page,
          pageSize: resources.openStackCatalog.pageSize,
          total: resources.openStackCatalog.total,
          onPageChange: resources.openStackCatalog.setPage,
          onPageSizeChange: resources.openStackCatalog.setPageSize,
        },
      } : undefined}
    />
  );
}
