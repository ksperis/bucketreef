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
} from "./AdminAssociationPicker";
import type { AdminSimpleAssociationOption } from "./AdminSimpleIdAssociationsPanel";

type AdminRgwUserAccessLink = {
  allow_manager_browser_data_access: boolean;
};

export type AdminRgwUserAccessAssociationsState<
  TLink extends AdminRgwUserAccessLink,
> = {
  selected: TLink[];
  setSelected: Dispatch<SetStateAction<TLink[]>>;
  getId: (link: TLink) => number;
  createLink: (id: number) => TLink;
  withAccess: (link: TLink, allowed: boolean) => TLink;
  labelById: Map<number, string>;
  available: AdminSimpleAssociationOption[];
  visible: AdminSimpleAssociationOption[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  loading: boolean;
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
  toggleSelection: (id: number) => void;
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
  const resetPicker = () => {
    state.setShowPanel(false);
    state.setSelections([]);
    state.setSearch("");
  };
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
          addDisabled={state.selections.length === 0}
          onCancel={resetPicker}
          onAdd={() => {
            if (state.selections.length === 0) return;
            state.setSelected((current) =>
              normalizeSelection([
                ...current,
                ...state.selections.map(state.createLink),
              ]),
            );
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
