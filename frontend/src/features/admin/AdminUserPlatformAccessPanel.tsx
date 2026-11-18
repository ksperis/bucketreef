/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { ManagerFeaturePolicies } from "../../api/appSettings";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import type { EffectiveUserAccess, PlatformAccessFields } from "../../api/users";
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

type PlatformAccessValue = Partial<PlatformAccessFields>;

type AdminUserPlatformAccessPanelProps = {
  value: PlatformAccessValue;
  supportsCephAdmin: boolean;
  canGrantCephAdmin: boolean;
  canGrantStorageOps: boolean;
  supportsManagerTools: boolean;
  managerFeaturePolicies: ManagerFeaturePolicies;
  effectiveAccess?: EffectiveUserAccess | null;
  text: UsersText;
  onChange: (patch: PlatformAccessValue) => void;
};

export default function AdminUserPlatformAccessPanel({
  value,
  supportsCephAdmin,
  canGrantCephAdmin,
  canGrantStorageOps,
  supportsManagerTools,
  managerFeaturePolicies,
  effectiveAccess,
  text,
  onChange,
}: AdminUserPlatformAccessPanelProps) {
  const managerTools = buildManagerToolDefinitions({
    manager_feature_policies: managerFeaturePolicies,
  });
  const managedProvisioningPolicy =
    managerFeaturePolicies.managed_private_connection_provisioning;
  const effectiveAccessPresentation = effectiveAccess ? "detailed" as const : "none" as const;

  return (
    <>
      <WorkspaceAccessSection
        description={text("operationalWorkspaces")}
        cephAdmin={{
          title: text("cephAdminAccess"),
          description: text("cephAdminAccessDescription"),
          checked: supportsCephAdmin && Boolean(value.can_access_ceph_admin),
          disabled: !canGrantCephAdmin,
          eligible: supportsCephAdmin,
          inherited: Boolean(effectiveAccess?.group_can_access_ceph_admin),
          effectiveAccessPresentation,
          onChange: (enabled) => onChange({ can_access_ceph_admin: enabled }),
          ariaLabel: text("allowCephAdmin"),
        }}
        storageOps={{
          title: text("storageOpsAccess"),
          description: text("storageOpsAccessDescription"),
          checked: supportsManagerTools && Boolean(value.can_access_storage_ops),
          disabled: !canGrantStorageOps,
          eligible: supportsManagerTools,
          inherited: Boolean(effectiveAccess?.group_can_access_storage_ops),
          effectiveAccessPresentation,
          onChange: (enabled) => onChange({ can_access_storage_ops: enabled }),
          ariaLabel: text("allowStorageOps"),
        }}
      />
      {!supportsManagerTools && (
        <PageBanner tone="warning">{text("managerRoleRequirement")}</PageBanner>
      )}

      <ManagerToolAccessSection
        eligible={supportsManagerTools}
        inheritedAccess={effectiveAccess?.group_manager_tool_access}
        effectiveAccessPresentation={effectiveAccessPresentation}
        title={text("manager")}
        additionalItems={[
          {
            title: text("provisionConnections"),
            description: text("provisionConnectionsDescription"),
            checked:
              supportsManagerTools &&
              Boolean(value.can_provision_managed_private_connections),
            platformDefault: managedProvisioningPolicy === "default_on",
            inherited: Boolean(
              effectiveAccess?.group_can_provision_managed_private_connections,
            ),
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
      <AdminAccessToggleSection
        title={text("rgwMultisite")}
        description={text("rgwMultisitePermissions")}
        items={[
          {
            title: text("switchRgwMultisiteEndpoints"),
            description: text("switchRgwMultisiteEndpointsDescription"),
            checked: supportsManagerTools && Boolean(value.allow_multisite_endpoint_switching),
            inherited: Boolean(effectiveAccess?.group_allow_multisite_endpoint_switching),
            eligible: supportsManagerTools,
            effectiveAccessPresentation,
            disabled: !supportsManagerTools,
            onChange: (enabled) => onChange({ allow_multisite_endpoint_switching: enabled }),
            ariaLabel: text("allowRgwMultisiteEndpointSwitching"),
          },
        ]}
      />
      <BrowserAccessSection
        description={text("browserOptions")}
        checked={Boolean(value.browser_advanced_features_enabled)}
        inherited={Boolean(effectiveAccess?.group_browser_advanced_features_enabled)}
        effectiveAccessPresentation={effectiveAccessPresentation}
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
            inherited: Boolean(
              effectiveAccess?.group_can_create_manual_private_connections,
            ),
            eligible: supportsManagerTools,
            effectiveAccessPresentation,
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
