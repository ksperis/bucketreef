/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type { UiGroupSummary } from "../../api/groups";
import type { S3UserMembership } from "../../api/users";
import type { AccountSelection } from "./UserAccountAssociationsPanel";

export const MAX_VISIBLE_USER_ASSOCIATION_OPTIONS = 10;

type AssociationOption = {
  id: number;
  label: string;
};

type AssociationEditorState = {
  accounts: {
    selected: AccountSelection[];
    picker: { search: string };
  };
  s3Users: {
    selected: S3UserMembership[];
    picker: { search: string };
  };
  connections: {
    selected: number[];
    picker: { search: string };
  };
  openStack: {
    selected: number[];
    picker: { search: string };
  };
  groups: {
    selected: number[];
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

type DerivedOptions = {
  accounts: { available: AssociationOption[]; visible: AssociationOption[] };
  s3Users: { available: AssociationOption[]; visible: AssociationOption[] };
  connections: { available: AssociationOption[]; visible: AssociationOption[] };
  openStack: { available: AssociationOption[]; visible: AssociationOption[] };
  groups: UiGroupSummary[];
};

function normalizedSearch(value: string) {
  return value.trim().toLowerCase();
}

function filterOptions(
  options: AssociationOption[],
  selectedIds: ReadonlySet<number>,
  search: string,
) {
  const query = normalizedSearch(search);
  return options.filter(
    (option) =>
      !selectedIds.has(Number(option.id)) &&
      (!query || option.label.toLowerCase().includes(query)),
  );
}

function withVisible(options: AssociationOption[], maxVisibleOptions: number) {
  return {
    available: options,
    visible: options.slice(0, maxVisibleOptions),
  };
}

export function deriveAdminUserAssociationOptions(
  editor: AssociationEditorState,
  sources: AssociationOptionSources,
  maxVisibleOptions = MAX_VISIBLE_USER_ASSOCIATION_OPTIONS,
): DerivedOptions {
  const accounts = filterOptions(
    sources.accountOptions,
    new Set(editor.accounts.selected.map((account) => Number(account.id))),
    editor.accounts.picker.search,
  );
  const s3Users = filterOptions(
    sources.s3UserOptions,
    new Set(editor.s3Users.selected.map((link) => link.s3_user_id)),
    editor.s3Users.picker.search,
  );
  const connections = filterOptions(
    sources.s3ConnectionOptions,
    new Set(editor.connections.selected),
    editor.connections.picker.search,
  );
  const openStack = filterOptions(
    sources.openStackOptions,
    new Set(editor.openStack.selected),
    editor.openStack.picker.search,
  );
  const groupSearch = normalizedSearch(editor.groups.picker.search);
  const selectedGroupIds = new Set(editor.groups.selected);
  const groups = sources.groups.filter(
    (group) =>
      !group.system_key &&
      !selectedGroupIds.has(group.id) &&
      (!groupSearch || group.name.toLowerCase().includes(groupSearch)),
  );

  return {
    accounts: withVisible(accounts, maxVisibleOptions),
    s3Users: withVisible(s3Users, maxVisibleOptions),
    connections: withVisible(connections, maxVisibleOptions),
    openStack: withVisible(openStack, maxVisibleOptions),
    groups,
  };
}

export default function useAdminUserAssociationDerivedOptions(
  editor: AssociationEditorState,
  sources: AssociationOptionSources,
  maxVisibleOptions = MAX_VISIBLE_USER_ASSOCIATION_OPTIONS,
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
