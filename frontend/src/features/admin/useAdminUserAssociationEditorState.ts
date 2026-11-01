/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3UserMembership } from "../../api/users";
import type { AccountSelection } from "./UserAccountAssociationsPanel";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";
import useAdminStorageAssociationEditorState, {
  type StorageAssociationTab,
} from "./useAdminStorageAssociationEditorState";

type AssociationEditorSeed = {
  selectedS3Accounts?: AccountSelection[];
  selectedS3Users?: S3UserMembership[];
  selectedS3Connections?: number[];
  selectedOpenStackClouds?: number[];
  selectedGroups?: number[];
  associationsTab?: StorageAssociationTab;
};

export default function useAdminUserAssociationEditorState() {
  const [selectedS3Accounts, setSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [selectedS3Users, setSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [selectedS3Connections, setSelectedS3Connections] = useState<number[]>([]);
  const [selectedOpenStackClouds, setSelectedOpenStackClouds] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const storageAssociations = useAdminStorageAssociationEditorState();
  const groupPicker = useAdminAssociationPickerState();
  const clearStoragePendingSelections =
    storageAssociations.clearPendingSelections;
  const resetStorageAssociations = storageAssociations.reset;
  const setGroupSelections = groupPicker.setSelections;
  const resetGroupPicker = groupPicker.reset;

  const clearPendingSelections = useCallback(() => {
    clearStoragePendingSelections();
    setGroupSelections([]);
  }, [clearStoragePendingSelections, setGroupSelections]);

  const reset = useCallback((seed: AssociationEditorSeed = {}) => {
    setSelectedS3Accounts(seed.selectedS3Accounts ?? []);
    setSelectedS3Users(seed.selectedS3Users ?? []);
    setSelectedS3Connections(seed.selectedS3Connections ?? []);
    setSelectedOpenStackClouds(seed.selectedOpenStackClouds ?? []);
    setSelectedGroups(seed.selectedGroups ?? []);
    resetStorageAssociations(seed.associationsTab);
    resetGroupPicker();
  }, [resetGroupPicker, resetStorageAssociations]);

  return {
    accounts: {
      selected: selectedS3Accounts,
      setSelected: setSelectedS3Accounts,
      accessChoice: storageAssociations.accounts.accessChoice,
      setAccessChoice: storageAssociations.accounts.setAccessChoice,
      picker: storageAssociations.accounts.picker,
    },
    s3Users: {
      selected: selectedS3Users,
      setSelected: setSelectedS3Users,
      picker: storageAssociations.s3Users.picker,
    },
    connections: {
      selected: selectedS3Connections,
      setSelected: setSelectedS3Connections,
      picker: storageAssociations.connections.picker,
    },
    openStack: {
      selected: selectedOpenStackClouds,
      setSelected: setSelectedOpenStackClouds,
      picker: storageAssociations.openStack.picker,
    },
    groups: {
      selected: selectedGroups,
      setSelected: setSelectedGroups,
      picker: groupPicker,
    },
    tab: storageAssociations.tab,
    setTab: storageAssociations.setTab,
    closePickers: storageAssociations.closePickers,
    clearPendingSelections,
    reset,
  };
}

export type AdminUserAssociationEditorState = ReturnType<
  typeof useAdminUserAssociationEditorState
>;
