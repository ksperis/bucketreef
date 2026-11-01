/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import type { AccountAccessGrant } from "../../api/accountAccess";
import useAdminAssociationPickerState from "./useAdminAssociationPickerState";

export type StorageAssociationTab =
  | "accounts"
  | "s3_users"
  | "connections"
  | "openstack";

export default function useAdminStorageAssociationEditorState() {
  const [tab, setTab] = useState<StorageAssociationTab>("accounts");
  const [accountAccessChoice, setAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const accountPicker = useAdminAssociationPickerState();
  const s3UserPicker = useAdminAssociationPickerState();
  const connectionPicker = useAdminAssociationPickerState();
  const openStackPicker = useAdminAssociationPickerState();
  const {
    setOpen: setAccountPickerOpen,
    setSelections: setAccountSelections,
    reset: resetAccountPicker,
  } = accountPicker;
  const {
    setOpen: setS3UserPickerOpen,
    setSelections: setS3UserSelections,
    reset: resetS3UserPicker,
  } = s3UserPicker;
  const {
    setOpen: setConnectionPickerOpen,
    setSelections: setConnectionSelections,
    reset: resetConnectionPicker,
  } = connectionPicker;
  const {
    setOpen: setOpenStackPickerOpen,
    setSelections: setOpenStackSelections,
    reset: resetOpenStackPicker,
  } = openStackPicker;

  const closePickers = useCallback(() => {
    setAccountPickerOpen(false);
    setS3UserPickerOpen(false);
    setConnectionPickerOpen(false);
    setOpenStackPickerOpen(false);
  }, [
    setAccountPickerOpen,
    setConnectionPickerOpen,
    setOpenStackPickerOpen,
    setS3UserPickerOpen,
  ]);

  const clearPendingSelections = useCallback(() => {
    setAccountSelections([]);
    setS3UserSelections([]);
    setConnectionSelections([]);
    setOpenStackSelections([]);
    setAccountAccessChoice({});
  }, [
    setAccountSelections,
    setConnectionSelections,
    setOpenStackSelections,
    setS3UserSelections,
  ]);

  const reset = useCallback(
    (nextTab: StorageAssociationTab = "accounts") => {
      setTab(nextTab);
      setAccountAccessChoice({});
      resetAccountPicker();
      resetS3UserPicker();
      resetConnectionPicker();
      resetOpenStackPicker();
    },
    [
      resetAccountPicker,
      resetConnectionPicker,
      resetOpenStackPicker,
      resetS3UserPicker,
    ],
  );

  return {
    accounts: {
      accessChoice: accountAccessChoice,
      setAccessChoice: setAccountAccessChoice,
      picker: accountPicker,
    },
    s3Users: { picker: s3UserPicker },
    connections: { picker: connectionPicker },
    openStack: { picker: openStackPicker },
    tab,
    setTab,
    closePickers,
    clearPendingSelections,
    reset,
  };
}
