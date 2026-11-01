/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import type { UiGroupSummary } from "../../api/groups";
import AdminSimpleIdAssociationsPanel from "./AdminSimpleIdAssociationsPanel";
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
  const available = visibleGroups.map((group) => ({ id: group.id, label: group.name }));

  return (
    <AdminSimpleIdAssociationsPanel
      state={{
        selected: selectedIds,
        setSelected: setSelectedIds,
        labelById: new Map(
          [...groupById.entries()].map(([id, group]) => [id, group.name]),
        ),
        available,
        visible: available.slice(0, maxVisibleOptions),
        search,
        setSearch,
        loading: groupsLoading,
        showPanel,
        setShowPanel,
        selections,
        setSelections,
        toggleSelection: (id) =>
          setSelections((current) =>
            current.includes(id)
              ? current.filter((selectedId) => selectedId !== id)
              : [...current, id],
          ),
      }}
      maxVisibleOptions={maxVisibleOptions}
      primaryLabel={text("group")}
      actionsLabel={text("actions")}
      removeLabel={text("remove")}
      loadingMessage={text("loadingGroups")}
      emptyMessage={text("noLinkedGroups")}
      pickerTitle={text("addUiGroups")}
      searchHint={text("searchByName")}
      fallbackLabel={(id) => text("groupById", { id })}
      searchAriaLabel={text("searchUiGroups")}
      pickerEmptyMessage={text(groupsLoaded ? "noUiGroupsAvailable" : "noResults")}
      normalizeSelection={(ids) => [...new Set(ids)].sort((left, right) => left - right)}
      section={{
        title: text("linkedUiGroups"),
        countLabel: text("linkedCount", { count: selectedIds.length }),
        actionLabel: text(showPanel ? "close" : "addUiGroups"),
      }}
    />
  );
}
