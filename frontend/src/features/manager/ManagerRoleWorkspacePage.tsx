/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useLocation, useParams } from "react-router-dom";

import PageEmptyState from "../../components/PageEmptyState";
import ManagerResourceWorkspace from "./ManagerResourceWorkspace";
import ManagerRoleEditor from "./ManagerRoleEditor";
import ManagerRolePoliciesPage from "./ManagerRolePoliciesPage";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";
import { useExecutionContext } from "./ExecutionContextProvider";

type RoleTab = "general" | "trust" | "policies";

export default function ManagerRoleWorkspacePage() {
  const { text } = useManagerI18n();
  const location = useLocation();
  const { roleName } = useParams<{ roleName: string }>();
  const { selectedContextKind, contextIdForApi, requiresContextSelection } = useExecutionContext();
  const needsSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";
  const name = (() => {
    if (!roleName) return "";
    try { return decodeURIComponent(roleName); } catch { return roleName; }
  })();

  if (needsSelection) {
    return (
      <PageEmptyState
        title={text("Select a context before managing IAM roles")}
        description={text("Roles are defined per execution context. Choose a context to edit this role.")}
        primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
        tone="warning"
      />
    );
  }
  if (isS3User) {
    return (
      <PageEmptyState
        title={text("IAM roles are unavailable for managed S3 user contexts")}
        description={text("Switch to an RGW account or S3 connection context to manage roles.")}
        primaryAction={{ label: text("Back to roles"), to: "/manager/roles" }}
        tone="warning"
      />
    );
  }

  const encodedName = encodeURIComponent(name);
  const baseRoute = `/manager/roles/${encodedName}`;
  const activeTab: RoleTab = location.pathname.endsWith("/trust")
    ? "trust"
    : location.pathname.endsWith("/policies")
      ? "policies"
      : "general";
  const tabs = [
    { id: "general" as const, label: text("General"), to: baseRoute },
    { id: "trust" as const, label: text("Trust policy"), to: `${baseRoute}/trust` },
    { id: "policies" as const, label: text("Policies"), to: `${baseRoute}/policies` },
  ];

  return (
    <ManagerResourceWorkspace
      title={text("IAM role: {name}", { name })}
      description={text("Manage role settings, trust relationships, and policies from one workspace.")}
      breadcrumbs={managerPageBreadcrumbs(text, "roles", { label: name })}
      backLabel={text("← Back to roles")}
      backTo="/manager/roles"
      tabs={tabs}
      activeTab={activeTab}
    >
      {activeTab === "general" && (
        <ManagerRoleEditor
          key={`${contextIdForApi}:${name}:general`}
          contextId={contextIdForApi}
          roleName={name}
          mode="general"
          embedded
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      )}
      {activeTab === "trust" && (
        <ManagerRoleEditor
          key={`${contextIdForApi}:${name}:trust`}
          contextId={contextIdForApi}
          roleName={name}
          mode="trust"
          embedded
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      )}
      {activeTab === "policies" && <ManagerRolePoliciesPage embedded />}
    </ManagerResourceWorkspace>
  );
}
