/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ComponentProps, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/PageHeader";
import WorkflowTabs from "../../components/WorkflowTabs";

type ManagerResourceWorkspaceTab<T extends string> = {
  id: T;
  label: string;
  to: string;
};

export default function ManagerResourceWorkspace<T extends string>({
  title,
  description,
  breadcrumbs,
  backLabel,
  backTo,
  tabs,
  activeTab,
  actions = [],
  children,
}: {
  title: string;
  description?: ReactNode;
  breadcrumbs?: ComponentProps<typeof PageHeader>["breadcrumbs"];
  backLabel: string;
  backTo: string;
  tabs: ManagerResourceWorkspaceTab<T>[];
  activeTab: T;
  actions?: ComponentProps<typeof PageHeader>["actions"];
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <PageHeader
        actionPresentation="listing"
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={[
          { label: backLabel, to: backTo, variant: "ghost" },
          ...actions,
        ]}
      />
      <WorkflowTabs
        activeTab={activeTab}
        onTabChange={(tabId) => {
          const target = tabs.find((tab) => tab.id === tabId);
          if (target) navigate(target.to);
        }}
        tabs={tabs}
        ariaLabel={title}
      >
        {children}
      </WorkflowTabs>
    </div>
  );
}
