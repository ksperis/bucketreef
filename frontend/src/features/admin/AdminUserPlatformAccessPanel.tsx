/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { ManagerFeaturePolicies } from "../../api/appSettings";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import type { ManagerToolAccess, UpdateUserPayload } from "../../api/users";
import PageBanner from "../../components/PageBanner";
import {
  AdminAccessToggleSection,
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import {
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
} from "./adminAccessConfig";
import type { UsersText } from "./usersMessage";

type PlatformAccessValue = Pick<
  UpdateUserPayload,
  | "can_access_ceph_admin"
  | "can_access_storage_ops"
  | "can_create_manual_private_connections"
  | "can_provision_managed_private_connections"
  | "manager_tool_access"
  | "browser_advanced_features_enabled"
>;

type AdminUserPlatformAccessPanelProps = {
  value: PlatformAccessValue;
  canGrantCephAdmin: boolean;
  canGrantStorageOps: boolean;
  supportsManagerTools: boolean;
  managerFeaturePolicies: ManagerFeaturePolicies;
  inheritedManagerToolAccess?: ManagerToolAccess | null;
  inheritedManagedProvisioning?: boolean;
  text: UsersText;
  onChange: (patch: PlatformAccessValue) => void;
};

export default function AdminUserPlatformAccessPanel({
  value,
  canGrantCephAdmin,
  canGrantStorageOps,
  supportsManagerTools,
  managerFeaturePolicies,
  inheritedManagerToolAccess,
  inheritedManagedProvisioning = false,
  text,
  onChange,
}: AdminUserPlatformAccessPanelProps) {
  const managerTools = buildManagerToolDefinitions({
    manager_feature_policies: managerFeaturePolicies,
  });
  const managedProvisioningPolicy =
    managerFeaturePolicies.managed_private_connection_provisioning;

  return (
    <>
      <WorkspaceAccessSection
        description={text("operationalWorkspaces")}
        cephAdmin={{
          title: text("cephAdminAccess"),
          description: text("cephAdminAccessDescription"),
          checked: canGrantCephAdmin && Boolean(value.can_access_ceph_admin),
          disabled: !canGrantCephAdmin,
          onChange: (enabled) => onChange({ can_access_ceph_admin: enabled }),
          ariaLabel: text("allowCephAdmin"),
        }}
        storageOps={{
          title: text("storageOpsAccess"),
          description: text("storageOpsAccessDescription"),
          checked: canGrantStorageOps && Boolean(value.can_access_storage_ops),
          disabled: !canGrantStorageOps,
          onChange: (enabled) => onChange({ can_access_storage_ops: enabled }),
          ariaLabel: text("allowStorageOps"),
        }}
      />
      {!supportsManagerTools && (
        <PageBanner tone="warning">{text("managerRoleRequirement")}</PageBanner>
      )}

      <ManagerToolAccessSection
        eligible={supportsManagerTools}
        inheritedAccess={inheritedManagerToolAccess}
        title={text("manager")}
        additionalItems={[
          {
            title: text("provisionConnections"),
            description: text("provisionConnectionsDescription"),
            checked:
              supportsManagerTools &&
              Boolean(value.can_provision_managed_private_connections),
            platformDefault: managedProvisioningPolicy === "default_on",
            inherited: inheritedManagedProvisioning,
            blocked: !isFeaturePolicyAvailable(managedProvisioningPolicy),
            disabled: !supportsManagerTools,
            onChange: (enabled) =>
              onChange({ can_provision_managed_private_connections: enabled }),
            ariaLabel: text("allowProvisionConnections"),
          },
        ]}
        description={text("managerPermissions")}
        tools={managerTools}
        access={value.manager_tool_access}
        isToolDisabled={(tool) => !supportsManagerTools || !tool.enabled}
        onChange={(key, enabled) =>
          onChange({
            manager_tool_access: {
              ...normalizeManagerToolAccess(value.manager_tool_access),
              [key]: enabled,
            },
          })
        }
      />
      <BrowserAccessSection
        description={text("browserOptions")}
        checked={Boolean(value.browser_advanced_features_enabled)}
        onChange={(enabled) =>
          onChange({ browser_advanced_features_enabled: enabled })
        }
      />
      <AdminAccessToggleSection
        title={text("connections")}
        description={text("privateConnectionPermissions")}
        items={[
          {
            title: text("createManualConnections"),
            description: text("manualConnectionsDescription"),
            checked:
              supportsManagerTools &&
              Boolean(value.can_create_manual_private_connections),
            disabled: !supportsManagerTools,
            onChange: (enabled) =>
              onChange({ can_create_manual_private_connections: enabled }),
            ariaLabel: text("allowManualConnections"),
          },
        ]}
      />
    </>
  );
}
