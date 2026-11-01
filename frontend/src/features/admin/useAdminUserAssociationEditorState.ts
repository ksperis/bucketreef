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
  selectedOpenStackClouds?: number[];
  selectedGroups?: number[];
  associationsTab?: AssociationTab;
};

export default function useAdminUserAssociationEditorState() {
  const [selectedS3Accounts, setSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [selectedS3Users, setSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [selectedS3Connections, setSelectedS3Connections] = useState<number[]>([]);
  const [selectedOpenStackClouds, setSelectedOpenStackClouds] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [accountAccessChoice, setAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [associationsTab, setAssociationsTab] = useState<AssociationTab>("accounts");
  const accountPicker = useAdminAssociationPickerState();
  const s3UserPicker = useAdminAssociationPickerState();
  const connectionPicker = useAdminAssociationPickerState();
  const openStackPicker = useAdminAssociationPickerState();
  const groupPicker = useAdminAssociationPickerState();

  const clearPendingSelections = useCallback(() => {
    accountPicker.setSelections([]);
    s3UserPicker.setSelections([]);
    connectionPicker.setSelections([]);
    openStackPicker.setSelections([]);
    groupPicker.setSelections([]);
    setAccountAccessChoice({});
  }, [accountPicker, connectionPicker, groupPicker, openStackPicker, s3UserPicker]);

  const reset = useCallback((seed: AssociationEditorSeed = {}) => {
    setSelectedS3Accounts(seed.selectedS3Accounts ?? []);
    setSelectedS3Users(seed.selectedS3Users ?? []);
    setSelectedS3Connections(seed.selectedS3Connections ?? []);
    setSelectedOpenStackClouds(seed.selectedOpenStackClouds ?? []);
    setSelectedGroups(seed.selectedGroups ?? []);
    setAccountAccessChoice({});
    setAssociationsTab(seed.associationsTab ?? "accounts");
    accountPicker.reset();
    s3UserPicker.reset();
    connectionPicker.reset();
    openStackPicker.reset();
    groupPicker.reset();
  }, [accountPicker, connectionPicker, groupPicker, openStackPicker, s3UserPicker]);

  return {
    accounts: {
      selected: selectedS3Accounts,
      setSelected: setSelectedS3Accounts,
      accessChoice: accountAccessChoice,
      setAccessChoice: setAccountAccessChoice,
      picker: accountPicker,
    },
    s3Users: {
      selected: selectedS3Users,
      setSelected: setSelectedS3Users,
      picker: s3UserPicker,
    },
    connections: {
      selected: selectedS3Connections,
      setSelected: setSelectedS3Connections,
      picker: connectionPicker,
    },
    openStack: {
      selected: selectedOpenStackClouds,
      setSelected: setSelectedOpenStackClouds,
      picker: openStackPicker,
    },
    groups: {
      selected: selectedGroups,
      setSelected: setSelectedGroups,
      picker: groupPicker,
    },
    tab: associationsTab,
    setTab: setAssociationsTab,
    clearPendingSelections,
    reset,
  };
}
