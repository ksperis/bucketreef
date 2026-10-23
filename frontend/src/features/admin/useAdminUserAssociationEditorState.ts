/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { AccountAccessGrant } from "../../api/accountAccess";
import type { S3UserMembership } from "../../api/users";
import type { AccountSelection } from "./UserAccountAssociationsPanel";
import type { AssociationTab } from "./UserAssociationsTabs";

type AssociationEditorSeed = {
  selectedS3Accounts?: AccountSelection[];
  selectedS3Users?: S3UserMembership[];
  selectedS3Connections?: number[];
  selectedGroups?: number[];
  associationsTab?: AssociationTab;
};

const toggleId = (values: number[], id: number) =>
  values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export default function useAdminUserAssociationEditorState() {
  const [selectedS3Accounts, setSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [selectedS3Users, setSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [selectedS3Connections, setSelectedS3Connections] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [accountAccessChoice, setAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [s3AccountSearch, setS3AccountSearch] = useState("");
  const [s3Search, setS3Search] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [associationsTab, setAssociationsTab] = useState<AssociationTab>("accounts");
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [accountSelections, setAccountSelections] = useState<number[]>([]);
  const [showS3UserPanel, setShowS3UserPanel] = useState(false);
  const [s3UserSelections, setS3UserSelections] = useState<number[]>([]);
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  const [connectionSelections, setConnectionSelections] = useState<number[]>([]);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [groupSelections, setGroupSelections] = useState<number[]>([]);

  const clearPendingSelections = useCallback(() => {
    setAccountSelections([]);
    setS3UserSelections([]);
    setConnectionSelections([]);
    setGroupSelections([]);
    setAccountAccessChoice({});
  }, []);

  const reset = useCallback((seed: AssociationEditorSeed = {}) => {
    setSelectedS3Accounts(seed.selectedS3Accounts ?? []);
    setSelectedS3Users(seed.selectedS3Users ?? []);
    setSelectedS3Connections(seed.selectedS3Connections ?? []);
    setSelectedGroups(seed.selectedGroups ?? []);
    setAccountAccessChoice({});
    setS3AccountSearch("");
    setS3Search("");
    setConnectionSearch("");
    setGroupSearch("");
    setAssociationsTab(seed.associationsTab ?? "accounts");
    setShowAccountPanel(false);
    setShowS3UserPanel(false);
    setShowConnectionPanel(false);
    setShowGroupPanel(false);
    setAccountSelections([]);
    setS3UserSelections([]);
    setConnectionSelections([]);
    setGroupSelections([]);
  }, []);

  const toggleAccountSelection = useCallback((accountId: number) => {
    setAccountSelections((current) => toggleId(current, accountId));
  }, []);
  const toggleS3UserSelection = useCallback((userId: number) => {
    setS3UserSelections((current) => toggleId(current, userId));
  }, []);
  const toggleConnectionSelection = useCallback((connectionId: number) => {
    setConnectionSelections((current) => toggleId(current, connectionId));
  }, []);

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
    s3AccountSearch,
    setS3AccountSearch,
    s3Search,
    setS3Search,
    connectionSearch,
    setConnectionSearch,
    groupSearch,
    setGroupSearch,
    associationsTab,
    setAssociationsTab,
    showAccountPanel,
    setShowAccountPanel,
    accountSelections,
    setAccountSelections,
    showS3UserPanel,
    setShowS3UserPanel,
    s3UserSelections,
    setS3UserSelections,
    showConnectionPanel,
    setShowConnectionPanel,
    connectionSelections,
    setConnectionSelections,
    showGroupPanel,
    setShowGroupPanel,
    groupSelections,
    setGroupSelections,
    clearPendingSelections,
    reset,
    toggleAccountSelection,
    toggleS3UserSelection,
    toggleConnectionSelection,
  };
}
