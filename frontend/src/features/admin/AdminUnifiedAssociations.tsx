/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import {
  AdminAssociationSectionHeader,
  adminAssociationTableContainerClass,
} from "./AdminAssociationPicker";

export type AdminUnifiedAssociationRow = {
  key: string;
  resource: ReactNode;
  type: ReactNode;
  manager: ReactNode;
  portal?: ReactNode;
  actions: ReactNode;
};

type AdminUnifiedAssociationAddAction = {
  key: string;
  label: ReactNode;
  onAction: () => void;
  disabled?: boolean;
};

type AdminUnifiedAssociationsProps = {
  title: string;
  rows: AdminUnifiedAssociationRow[];
  resourceLabel: string;
  typeLabel: string;
  managerLabel: string;
  portalLabel: string;
  actionsLabel: string;
  emptyMessage: string;
  countLabel: ReactNode;
  addActions: AdminUnifiedAssociationAddAction[];
  picker?: ReactNode;
};

export default function AdminUnifiedAssociations({
  title,
  rows,
  resourceLabel,
  typeLabel,
  managerLabel,
  portalLabel,
  actionsLabel,
  emptyMessage,
  countLabel,
  addActions,
  picker,
}: AdminUnifiedAssociationsProps) {
  const columns: DataTableColumn<AdminUnifiedAssociationRow>[] = [
    {
      id: "resource",
      label: resourceLabel,
      primary: true,
      cellClassName: "min-w-[220px] max-w-[320px]",
      render: (row) => row.resource,
    },
    {
      id: "type",
      label: typeLabel,
      render: (row) => row.type,
    },
    {
      id: "manager",
      label: managerLabel,
      render: (row) => row.manager,
    },
    {
      id: "portal",
      label: portalLabel,
      render: (row) => row.portal,
    },
    {
      id: "actions",
      label: actionsLabel,
      align: "right",
      mobileRole: "actions",
      render: (row) => row.actions,
    },
  ];

  return (
    <div className="space-y-3">
      <AdminAssociationSectionHeader
        title={title}
        countLabel={countLabel}
        actions={addActions}
      />
      {picker}
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        status={rows.length ? "ready" : "empty"}
        loadingMessage={emptyMessage}
        errorMessage={emptyMessage}
        emptyMessage={emptyMessage}
        containerClassName={adminAssociationTableContainerClass}
        responsiveCards
      />
    </div>
  );
}
