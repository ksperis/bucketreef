/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { AccountAccessGrant } from "../../api/accountAccess";
import type { S3UserMembership } from "../../api/users";
import type { AccountSelection } from "./UserAccountAssociationsPanel";
import type { AssociationTab } from "./UserAssociationsTabs";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";

type AssociationEditorSeed = {
  selectedS3Accounts?: AccountSelection[];
  selectedS3Users?: S3UserMembership[];
  selectedS3Connections?: number[];
  selectedGroups?: number[];
  associationsTab?: AssociationTab;
};

export default function useAdminUserAssociationEditorState() {
  const [selectedS3Accounts, setSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [selectedS3Users, setSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [selectedS3Connections, setSelectedS3Connections] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [accountAccessChoice, setAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [associationsTab, setAssociationsTab] = useState<AssociationTab>("accounts");
  const accountPicker = useAdminAssociationPickerState();
  const s3UserPicker = useAdminAssociationPickerState();
  const connectionPicker = useAdminAssociationPickerState();
  const groupPicker = useAdminAssociationPickerState();

  const clearPendingSelections = useCallback(() => {
    accountPicker.setSelections([]);
    s3UserPicker.setSelections([]);
    connectionPicker.setSelections([]);
    groupPicker.setSelections([]);
    setAccountAccessChoice({});
  }, [accountPicker, connectionPicker, groupPicker, s3UserPicker]);

  const reset = useCallback((seed: AssociationEditorSeed = {}) => {
    setSelectedS3Accounts(seed.selectedS3Accounts ?? []);
    setSelectedS3Users(seed.selectedS3Users ?? []);
    setSelectedS3Connections(seed.selectedS3Connections ?? []);
    setSelectedGroups(seed.selectedGroups ?? []);
    setAccountAccessChoice({});
    setAssociationsTab(seed.associationsTab ?? "accounts");
    accountPicker.reset();
    s3UserPicker.reset();
    connectionPicker.reset();
    groupPicker.reset();
  }, [accountPicker, connectionPicker, groupPicker, s3UserPicker]);

  return {
    selectedS3Accounts,
    setSelectedS3Accounts,
    selectedS3Users,
    setSelectedS3Users,
    selectedS3Connections,
    setSelectedS3Connections,
    selectedGroups,
    setSelectedGroups,
    accountAccessChoice,
    setAccountAccessChoice,
    s3AccountSearch: accountPicker.search,
    setS3AccountSearch: accountPicker.setSearch,
    s3Search: s3UserPicker.search,
    setS3Search: s3UserPicker.setSearch,
    connectionSearch: connectionPicker.search,
    setConnectionSearch: connectionPicker.setSearch,
    groupSearch: groupPicker.search,
    setGroupSearch: groupPicker.setSearch,
    associationsTab,
    setAssociationsTab,
    showAccountPanel: accountPicker.open,
    setShowAccountPanel: accountPicker.setOpen,
    accountSelections: accountPicker.selections,
    setAccountSelections: accountPicker.setSelections,
    showS3UserPanel: s3UserPicker.open,
    setShowS3UserPanel: s3UserPicker.setOpen,
    s3UserSelections: s3UserPicker.selections,
    setS3UserSelections: s3UserPicker.setSelections,
    showConnectionPanel: connectionPicker.open,
    setShowConnectionPanel: connectionPicker.setOpen,
    connectionSelections: connectionPicker.selections,
    setConnectionSelections: connectionPicker.setSelections,
    showGroupPanel: groupPicker.open,
    setShowGroupPanel: groupPicker.setOpen,
    groupSelections: groupPicker.selections,
    setGroupSelections: groupPicker.setSelections,
    clearPendingSelections,
    reset,
    toggleAccountSelection: accountPicker.toggleSelection,
    toggleS3UserSelection: s3UserPicker.toggleSelection,
    toggleConnectionSelection: connectionPicker.toggleSelection,
  };
}
