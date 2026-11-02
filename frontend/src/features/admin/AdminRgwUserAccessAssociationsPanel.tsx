/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, ReactNode, SetStateAction } from "react";

import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationTableContainerClass,
  resetAdminAssociationPicker,
  type AdminAssociationPickerState,
} from "./AdminAssociationPicker";

type AdminRgwUserAccessLink = {
  allow_manager_browser_data_access: boolean;
};

export type AdminRgwUserAccessAssociationsState<
  TLink extends AdminRgwUserAccessLink,
> = AdminAssociationPickerState & {
  selected: TLink[];
  setSelected: Dispatch<SetStateAction<TLink[]>>;
  getId: (link: TLink) => number;
  createLink: (id: number) => TLink;
  withAccess: (link: TLink, allowed: boolean) => TLink;
  labelById: Map<number, string>;
};

type AdminRgwUserAccessAssociationsPanelProps<
  TLink extends AdminRgwUserAccessLink,
> = {
  state: AdminRgwUserAccessAssociationsState<TLink>;
  maxVisibleOptions: number;
  primaryLabel: string;
  actionsLabel: string;
  removeLabel: string;
  loadingMessage: string;
  emptyMessage: string;
  pickerTitle: string;
  searchHint: string;
  fallbackLabel: (id: number) => string;
  searchAriaLabel?: string;
  pickerEmptyMessage?: string;
  normalizeSelection?: (links: TLink[]) => TLink[];
  section?: {
    title: string;
    countLabel: ReactNode;
    actionLabel: ReactNode;
  };
};

export default function AdminRgwUserAccessAssociationsPanel<
  TLink extends AdminRgwUserAccessLink,
>({
  state,
  maxVisibleOptions,
  primaryLabel,
  actionsLabel,
  removeLabel,
  loadingMessage,
  emptyMessage,
  pickerTitle,
  searchHint,
  fallbackLabel,
  searchAriaLabel,
  pickerEmptyMessage,
  normalizeSelection = (links) => links,
  section,
}: AdminRgwUserAccessAssociationsPanelProps<TLink>) {
  const columns: DataTableColumn<TLink>[] = [
    {
      id: "principal",
      label: primaryLabel,
      primary: true,
      render: (entry) => {
        const id = state.getId(entry);
        return state.labelById.get(id) ?? fallbackLabel(id);
      },
    },
    {
      id: "actions",
      label: actionsLabel,
      align: "right",
      mobileRole: "actions",
      render: (entry) => {
        const id = state.getId(entry);
        const label = state.labelById.get(id) ?? fallbackLabel(id);
        return (
          <ListActions>
            <AdminAssociationAdvancedSettings
              targetLabel={label}
              associationKind="rgw_user"
              allowManagerBrowserDataAccess={Boolean(
                entry.allow_manager_browser_data_access,
              )}
              onApply={(allowed) =>
                state.setSelected((current) =>
                  current.map((item) =>
                    state.getId(item) === id
                      ? state.withAccess(item, allowed)
                      : item,
                  ),
                )
              }
            />
            <ListActionButton
              type="button"
              variant="danger"
              onClick={() =>
                state.setSelected((current) =>
                  current.filter((item) => state.getId(item) !== id),
                )
              }
            >
              {removeLabel}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {section ? (
        <AdminAssociationSectionHeader
          title={section.title}
          countLabel={section.countLabel}
          actionLabel={section.actionLabel}
          onAction={() => state.setShowPanel((current) => !current)}
        />
      ) : null}
      <DataTableShell
        columns={columns}
        rows={state.selected}
        rowKey={state.getId}
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
          searchAriaLabel={searchAriaLabel}
          loading={state.loading}
          availableCount={state.available.length}
          maxVisibleOptions={maxVisibleOptions}
          selectedCount={state.selections.length}
          loadingLabel={loadingMessage}
          emptyLabel={pickerEmptyMessage}
          pagination={state.pagination}
          addDisabled={state.selections.length === 0}
          onCancel={() => resetAdminAssociationPicker(state)}
          onAdd={() => {
            if (state.selections.length === 0) return;
            state.setSelected((current) =>
              normalizeSelection([
                ...current,
                ...state.selections.map(state.createLink),
              ]),
            );
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
      ) : null}
    </div>
  );
}
