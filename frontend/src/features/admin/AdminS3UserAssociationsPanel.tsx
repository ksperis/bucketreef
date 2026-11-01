/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";

import type { S3UserMembership } from "../../api/users";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  adminAssociationTableContainerClass,
} from "./AdminAssociationPicker";
import type { AdminSimpleAssociationOption } from "./AdminSimpleIdAssociationsPanel";

export type AdminS3UserAssociationsState = {
  selected: S3UserMembership[];
  setSelected: Dispatch<SetStateAction<S3UserMembership[]>>;
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

type AdminS3UserAssociationsPanelProps = {
  state: AdminS3UserAssociationsState;
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
  normalizeSelection?: (links: S3UserMembership[]) => S3UserMembership[];
};

export default function AdminS3UserAssociationsPanel({
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
}: AdminS3UserAssociationsPanelProps) {
  const resetPicker = () => {
    state.setShowPanel(false);
    state.setSelections([]);
    state.setSearch("");
  };
  const columns: DataTableColumn<S3UserMembership>[] = [
    {
      id: "user",
      label: primaryLabel,
      primary: true,
      render: (entry) =>
        state.labelById.get(entry.s3_user_id) ?? fallbackLabel(entry.s3_user_id),
    },
    {
      id: "actions",
      label: actionsLabel,
      align: "right",
      mobileRole: "actions",
      render: (entry) => {
        const label =
          state.labelById.get(entry.s3_user_id) ?? fallbackLabel(entry.s3_user_id);
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
              variant="danger"
              onClick={() =>
                state.setSelected((current) =>
                  current.filter((item) => item.s3_user_id !== entry.s3_user_id),
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
      <DataTableShell
        columns={columns}
        rows={state.selected}
        rowKey={(entry) => entry.s3_user_id}
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
                ...state.selections.map((s3UserId) => ({
                  s3_user_id: s3UserId,
                  allow_manager_browser_data_access: false,
                })),
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
