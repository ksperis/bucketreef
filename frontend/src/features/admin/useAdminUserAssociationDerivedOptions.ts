/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type { UiGroupSummary } from "../../api/groups";
import {
  deriveAdminAssociationOptions,
  filterAdminAssociationOptions,
  MAX_VISIBLE_ASSOCIATION_OPTIONS,
} from "./adminAssociationOptions";
import type { AdminUserAssociationEditorState } from "./useAdminUserAssociationEditorState";

type AssociationOption = {
  id: number;
  label: string;
};

type AssociationEditorDerivationState = {
  accounts: {
    selected: AdminUserAssociationEditorState["accounts"]["selected"];
    picker: { search: string };
  };
  s3Users: {
    selected: AdminUserAssociationEditorState["s3Users"]["selected"];
    picker: { search: string };
  };
  connections: {
    selected: AdminUserAssociationEditorState["connections"]["selected"];
    picker: { search: string };
  };
  openStack: {
    selected: AdminUserAssociationEditorState["openStack"]["selected"];
    picker: { search: string };
  };
  groups: {
    selected: AdminUserAssociationEditorState["groups"]["selected"];
    picker: { search: string };
  };
};

type AssociationOptionSources = {
  accountOptions: AssociationOption[];
  s3UserOptions: AssociationOption[];
  s3ConnectionOptions: AssociationOption[];
  openStackOptions: AssociationOption[];
  groups: UiGroupSummary[];
};

export type AdminUserAssociationDerivedOptions = {
  accounts: { available: AssociationOption[]; visible: AssociationOption[] };
  s3Users: { available: AssociationOption[]; visible: AssociationOption[] };
  connections: { available: AssociationOption[]; visible: AssociationOption[] };
  openStack: { available: AssociationOption[]; visible: AssociationOption[] };
  groups: UiGroupSummary[];
};

export function deriveAdminUserAssociationOptions(
  editor: AssociationEditorDerivationState,
  sources: AssociationOptionSources,
  maxVisibleOptions = MAX_VISIBLE_ASSOCIATION_OPTIONS,
): AdminUserAssociationDerivedOptions {
  const deriveOptions = (
    items: AssociationOption[],
    selectedIds: ReadonlySet<number>,
    search: string,
  ) => deriveAdminAssociationOptions(
    {
      items,
      selectedIds,
      search,
      getId: (option) => Number(option.id),
      getLabel: (option) => option.label,
    },
    maxVisibleOptions,
  );

  return {
    accounts: deriveOptions(
      sources.accountOptions,
      new Set(editor.accounts.selected.map((account) => Number(account.id))),
      editor.accounts.picker.search,
    ),
    s3Users: deriveOptions(
      sources.s3UserOptions,
      new Set(editor.s3Users.selected.map((link) => link.s3_user_id)),
      editor.s3Users.picker.search,
    ),
    connections: deriveOptions(
      sources.s3ConnectionOptions,
      new Set(editor.connections.selected),
      editor.connections.picker.search,
    ),
    openStack: deriveOptions(
      sources.openStackOptions,
      new Set(editor.openStack.selected),
      editor.openStack.picker.search,
    ),
    groups: filterAdminAssociationOptions({
      items: sources.groups,
      selectedIds: new Set(editor.groups.selected),
      search: editor.groups.picker.search,
      getId: (group) => group.id,
      getLabel: (group) => group.name,
      include: (group) => !group.system_key,
    }),
  };
}

export default function useAdminUserAssociationDerivedOptions(
  editor: AdminUserAssociationEditorState,
  sources: AssociationOptionSources,
  maxVisibleOptions = MAX_VISIBLE_ASSOCIATION_OPTIONS,
) {
  const accountSelected = editor.accounts.selected;
  const accountSearch = editor.accounts.picker.search;
  const s3UserSelected = editor.s3Users.selected;
  const s3UserSearch = editor.s3Users.picker.search;
  const connectionSelected = editor.connections.selected;
  const connectionSearch = editor.connections.picker.search;
  const openStackSelected = editor.openStack.selected;
  const openStackSearch = editor.openStack.picker.search;
  const groupSelected = editor.groups.selected;
  const groupSearch = editor.groups.picker.search;
  const { accountOptions, s3UserOptions, s3ConnectionOptions, openStackOptions, groups } = sources;

  return useMemo(
    () => deriveAdminUserAssociationOptions(
      {
        accounts: { selected: accountSelected, picker: { search: accountSearch } },
        s3Users: { selected: s3UserSelected, picker: { search: s3UserSearch } },
        connections: { selected: connectionSelected, picker: { search: connectionSearch } },
        openStack: { selected: openStackSelected, picker: { search: openStackSearch } },
        groups: { selected: groupSelected, picker: { search: groupSearch } },
      },
      { accountOptions, s3UserOptions, s3ConnectionOptions, openStackOptions, groups },
      maxVisibleOptions,
    ),
    [
      accountOptions,
      accountSearch,
      accountSelected,
      connectionSearch,
      connectionSelected,
      groupSearch,
      groupSelected,
      groups,
      maxVisibleOptions,
      openStackOptions,
      openStackSearch,
      openStackSelected,
      s3ConnectionOptions,
      s3UserOptions,
      s3UserSearch,
      s3UserSelected,
    ],
  );
}
