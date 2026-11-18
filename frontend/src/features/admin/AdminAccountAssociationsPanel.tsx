/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";

import type { AccountAccessGrant } from "../../api/accountAccess";
import type { AdminAssociationPickerState } from "./AdminAssociationPicker";
import type { AdminAccountSelection } from "./adminAccountAssociationModel";

export type AdminAccountAssociationsState = AdminAssociationPickerState & {
  selected: AdminAccountSelection[];
  setSelected: Dispatch<SetStateAction<AdminAccountSelection[]>>;
  optionsById: Map<number, { name: string }>;
  accountAccessChoice: Record<number, AccountAccessGrant>;
  setAccountAccessChoice: Dispatch<SetStateAction<Record<number, AccountAccessGrant>>>;
};
