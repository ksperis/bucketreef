/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useLocation, useParams } from "react-router-dom";

import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import ManagerGroupPoliciesPage from "./ManagerGroupPoliciesPage";
import ManagerGroupUsersPage from "./ManagerGroupUsersPage";
import ManagerIamIdentityDetailPage from "./ManagerIamIdentityDetailPage";
import ManagerResourceWorkspace from "./ManagerResourceWorkspace";
import ManagerUserGroupsPage from "./ManagerUserGroupsPage";
import ManagerUserKeysPage from "./ManagerUserKeysPage";
import ManagerUserPoliciesPage from "./ManagerUserPoliciesPage";
import { useManagerI18n } from "./managerI18n";

type UserTab = "general" | "keys" | "groups" | "policies";
type GroupTab = "general" | "members" | "policies";

function decodeName(value?: string): string {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

export default function ManagerIamIdentityWorkspacePage({ kind }: { kind: "user" | "group" }) {
  const { text } = useManagerI18n();
  const location = useLocation();
  const params = useParams<{ userName?: string; groupName?: string }>();
  const name = decodeName(kind === "user" ? params.userName : params.groupName);
  const encodedName = encodeURIComponent(name);
  const listRoute = kind === "user" ? "/manager/users" : "/manager/groups";
  const baseRoute = `${listRoute}/${encodedName}`;

  if (kind === "user") {
    const activeTab: UserTab = location.pathname.endsWith("/keys")
      ? "keys"
      : location.pathname.endsWith("/groups")
        ? "groups"
        : location.pathname.endsWith("/policies")
          ? "policies"
          : "general";
    const tabs = [
      { id: "general" as const, label: text("General"), to: baseRoute },
      { id: "keys" as const, label: text("Keys"), to: `${baseRoute}/keys` },
      { id: "groups" as const, label: text("Groups"), to: `${baseRoute}/groups` },
      { id: "policies" as const, label: text("Policies"), to: `${baseRoute}/policies` },
    ];
    return (
      <ManagerResourceWorkspace
        title={text("IAM user: {name}", { name })}
        description={text("Manage the user identity, credentials, group membership, and policies from one workspace.")}
        breadcrumbs={managerPageBreadcrumbs(text, "users", { label: name })}
        backLabel={text("← Back to users")}
        backTo="/manager/users"
        tabs={tabs}
        activeTab={activeTab}
      >
        {activeTab === "general" && <ManagerIamIdentityDetailPage kind="user" embedded />}
        {activeTab === "keys" && <ManagerUserKeysPage embedded />}
        {activeTab === "groups" && <ManagerUserGroupsPage />}
        {activeTab === "policies" && <ManagerUserPoliciesPage embedded />}
      </ManagerResourceWorkspace>
    );
  }

  const activeTab: GroupTab = location.pathname.endsWith("/members")
    ? "members"
    : location.pathname.endsWith("/policies")
      ? "policies"
      : "general";
  const tabs = [
    { id: "general" as const, label: text("General"), to: baseRoute },
    { id: "members" as const, label: text("Members"), to: `${baseRoute}/members` },
    { id: "policies" as const, label: text("Policies"), to: `${baseRoute}/policies` },
  ];
  return (
    <ManagerResourceWorkspace
      title={text("IAM group: {name}", { name })}
      description={text("Manage the group identity, members, and policies from one workspace.")}
      breadcrumbs={managerPageBreadcrumbs(text, "groups", { label: name })}
      backLabel={text("← Back to groups")}
      backTo="/manager/groups"
      tabs={tabs}
      activeTab={activeTab}
    >
      {activeTab === "general" && <ManagerIamIdentityDetailPage kind="group" embedded />}
      {activeTab === "members" && <ManagerGroupUsersPage embedded />}
      {activeTab === "policies" && <ManagerGroupPoliciesPage embedded />}
    </ManagerResourceWorkspace>
  );
}
