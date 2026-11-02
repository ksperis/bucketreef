/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, ReactNode, SetStateAction } from "react";

import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationTableContainerClass,
  resetAdminAssociationPicker,
  type AdminAssociationPickerState,
} from "./AdminAssociationPicker";

export type AdminSimpleIdAssociationsState = AdminAssociationPickerState & {
  selected: number[];
  setSelected: Dispatch<SetStateAction<number[]>>;
  labelById: Map<number, string>;
};

type AdminSimpleIdAssociationsPanelProps = {
  state: AdminSimpleIdAssociationsState;
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
  normalizeSelection?: (ids: number[]) => number[];
  section?: {
    title: string;
    countLabel: ReactNode;
    actionLabel: ReactNode;
  };
};

export default function AdminSimpleIdAssociationsPanel({
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
  normalizeSelection = (ids) => ids,
  section,
}: AdminSimpleIdAssociationsPanelProps) {
  const columns: DataTableColumn<number>[] = [
    {
      id: "principal",
      label: primaryLabel,
      primary: true,
      render: (id) => state.labelById.get(id) ?? fallbackLabel(id),
    },
    {
      id: "actions",
      label: actionsLabel,
      align: "right",
      mobileRole: "actions",
      render: (id) => (
        <ListActions>
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() =>
              state.setSelected((current) => current.filter((selectedId) => selectedId !== id))
            }
          >
            {removeLabel}
          </ListActionButton>
        </ListActions>
      ),
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
              normalizeSelection([...current, ...state.selections]),
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
