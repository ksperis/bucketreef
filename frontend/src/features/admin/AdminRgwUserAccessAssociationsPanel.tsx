/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";

import type { AdminAssociationPickerState } from "./AdminAssociationPicker";
import type {
  AdminRgwUserAccessLink,
  AdminRgwUserAccessLinkAdapter,
} from "./adminRgwUserAccessAssociationModel";
import type { AdminPrincipalPresentation } from "./AdminPrincipalIdentity";

export type AdminRgwUserAccessAssociationsState<
  TLink extends AdminRgwUserAccessLink,
> = AdminAssociationPickerState & {
  selected: TLink[];
  setSelected: Dispatch<SetStateAction<TLink[]>>;
  adapter: AdminRgwUserAccessLinkAdapter<TLink>;
  labelById: Map<number, string>;
  principalById?: Map<number, AdminPrincipalPresentation>;
};
