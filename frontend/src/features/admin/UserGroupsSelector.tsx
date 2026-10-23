/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import type { UiGroupSummary } from "../../api/groups";
import { ListActionButton } from "../../components/list/ListControls";
import { AdminAssociationLinkedTable, AdminAssociationOptionCheckbox, AdminAssociationPickerPanel, adminAssociationOptionRowClass } from "./AdminAssociationPicker";
import { useUserI18n } from "./userMessage";

type UserGroupsSelectorProps = {
  groups: UiGroupSummary[];
  groupsLoaded: boolean;
  groupsLoading: boolean;
  maxVisibleOptions: number;
  selectedIds: number[];
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  visibleGroups: UiGroupSummary[];
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
};

export default function UserGroupsSelector({
  groups,
  groupsLoaded,
  groupsLoading,
  maxVisibleOptions,
  selectedIds,
  setSelectedIds,
  search,
  setSearch,
  visibleGroups,
  showPanel,
  setShowPanel,
  selections,
  setSelections,
}: UserGroupsSelectorProps) {
  const { text } = useUserI18n();
  const groupById = new Map(groups.map((group) => [group.id, group]));

  return (
    <AdminAssociationLinkedTable
      title={text("linkedUiGroups")}
      toolbar={{
        countLabel: text("linkedCount", { count: selectedIds.length }),
        actionLabel: text(showPanel ? "close" : "addUiGroups"),
        onAction: () => setShowPanel((current) => !current),
      }}
      headers={[{ label: text("group") }, { label: text("actions"), align: "right" }]}
      hasItems={selectedIds.length > 0}
      emptyLabel={text("noLinkedGroups")}
      rows={selectedIds.map((groupId) => (
        <tr key={groupId}>
          <td className="ui-table-primary">
            {groupById.get(groupId)?.name ?? text("groupById", { id: groupId })}
          </td>
          <td className="ui-table-actions-cell w-px text-right">
            <ListActionButton
              type="button"
              variant="danger"
              onClick={() =>
                setSelectedIds((current) => current.filter((id) => id !== groupId))
              }
            >
              {text("remove")}
            </ListActionButton>
          </td>
        </tr>
      ))}
      picker={
        showPanel ? (
          <AdminAssociationPickerPanel
            title={text("addUiGroups")}
            hint={text("searchByName")}
            search={search}
            onSearchChange={setSearch}
            searchAriaLabel={text("searchUiGroups")}
            loading={groupsLoading}
            availableCount={visibleGroups.length}
            maxVisibleOptions={maxVisibleOptions}
            selectedCount={selections.length}
            loadingLabel={text("loadingGroups")}
            emptyLabel={text(groupsLoaded ? "noUiGroupsAvailable" : "noResults")}
            addDisabled={selections.length === 0}
            onCancel={() => {
              setShowPanel(false);
              setSelections([]);
              setSearch("");
            }}
            onAdd={() => {
              setSelectedIds((current) =>
                [...new Set([...current, ...selections])].sort((left, right) => left - right),
              );
              setShowPanel(false);
              setSelections([]);
              setSearch("");
            }}
          >
            {visibleGroups.slice(0, maxVisibleOptions).map((group) => {
              const checked = selections.includes(group.id);
              return (
                <div key={group.id} className={adminAssociationOptionRowClass(checked)}>
                  <AdminAssociationOptionCheckbox
                    checked={checked}
                    onChange={() =>
                      setSelections((current) =>
                        current.includes(group.id)
                          ? current.filter((id) => id !== group.id)
                          : [...current, group.id],
                      )
                    }
                  >
                    <span>{group.name}</span>
                  </AdminAssociationOptionCheckbox>
                </div>
              );
            })}
          </AdminAssociationPickerPanel>
        ) : undefined
      }
    />
  );
}
