/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useMemo, type Dispatch, type SetStateAction } from "react";

import type { UiGroupPayload } from "../../api/groups";
import { isFeaturePolicyAvailable } from "../../api/featurePolicies";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import {
  AdminAccessToggleSection,
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import {
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  type ManagerToolKey,
} from "./adminAccessConfig";
import { useGroupsI18n } from "./groupsMessage";

interface AdminGroupAccessTabProps {
  form: UiGroupPayload;
  setForm: Dispatch<SetStateAction<UiGroupPayload>>;
}

export default function AdminGroupAccessTab({ form, setForm }: AdminGroupAccessTabProps) {
  const { text } = useGroupsI18n();
  const { generalSettings } = useGeneralSettings();
  const managerToolDefinitions = useMemo(
    () => buildManagerToolDefinitions(generalSettings),
    [generalSettings],
  );

  return (
    <>
      <WorkspaceAccessSection
        description={text("workspaceAccessDescription")}
        cephAdmin={{
          title: text("cephAdminAccess"),
          description: text("cephAdminAccessDescription"),
          checked: Boolean(form.can_access_ceph_admin),
          onChange: (value) =>
            setForm((current) => ({ ...current, can_access_ceph_admin: value })),
          ariaLabel: text("allowCephAdminAccess"),
        }}
        storageOps={{
          title: text("storageOpsAccess"),
          description: text("storageOpsAccessDescription"),
          checked: Boolean(form.can_access_storage_ops),
          onChange: (value) =>
            setForm((current) => ({ ...current, can_access_storage_ops: value })),
          ariaLabel: text("allowStorageOpsAccess"),
        }}
      />
      <ManagerToolAccessSection
        title={text("manager")}
        additionalItems={[
          {
            title: text("provisionManagedPrivateConnections"),
            description: text("managedProvisioningDescription"),
            checked: Boolean(form.can_provision_managed_private_connections),
            platformDefault:
              generalSettings.manager_feature_policies?.managed_private_connection_provisioning ===
              "default_on",
            blocked: !isFeaturePolicyAvailable(
              generalSettings.manager_feature_policies.managed_private_connection_provisioning,
            ),
            onChange: (value) =>
              setForm((current) => ({
                ...current,
                can_provision_managed_private_connections: value,
              })),
            ariaLabel: text("allowManagedProvisioning"),
          },
        ]}
        description={text("managerAccessDescription")}
        tools={managerToolDefinitions}
        access={form.manager_tool_access}
        onChange={(key: ManagerToolKey, value) =>
          setForm((current) => ({
            ...current,
            manager_tool_access: {
              ...normalizeManagerToolAccess(current.manager_tool_access),
              [key]: value,
            },
          }))
        }
      />
      <AdminAccessToggleSection
        title={text("rgwMultisite")}
        description={text("rgwMultisiteAccessDescription")}
        items={[
          {
            title: text("switchRgwMultisiteEndpoints"),
            description: text("switchRgwMultisiteEndpointsDescription"),
            checked: Boolean(form.allow_multisite_endpoint_switching),
            onChange: (value) =>
              setForm((current) => ({
                ...current,
                allow_multisite_endpoint_switching: value,
              })),
            ariaLabel: text("allowRgwMultisiteEndpointSwitching"),
          },
        ]}
      />
      <BrowserAccessSection
        description={text("browserAccessDescription")}
        checked={Boolean(form.browser_advanced_features_enabled)}
        onChange={(value) =>
          setForm((current) => ({
            ...current,
            browser_advanced_features_enabled: value,
          }))
        }
      />
      <AdminAccessToggleSection
        title={text("connections")}
        description={text("connectionAccessDescription")}
        items={[
          {
            title: text("createManualPrivateConnections"),
            description: text("manualConnectionsDescription"),
            checked: Boolean(form.can_create_manual_private_connections),
            onChange: (value) =>
              setForm((current) => ({
                ...current,
                can_create_manual_private_connections: value,
              })),
            ariaLabel: text("allowManualConnections"),
          },
        ]}
      />
    </>
  );
}
