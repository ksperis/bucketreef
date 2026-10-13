import type { ManagerToolAccess } from "../../api/users";
import {
  SettingsItem,
  SettingsSection,
  SettingsToggleAction,
} from "../../components/settings/SettingsLayout";
import {
  type ManagerToolDefinition,
  type ManagerToolKey,
  normalizeManagerToolAccess,
} from "./adminAccessConfig";
import type { UiTone } from "../../components/ui/styles";

type WorkspaceAccessToggle = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  ariaLabel: string;
  onChange: (value: boolean) => void;
  platformDefault?: boolean;
  inherited?: boolean;
  badge?: {
    visible?: boolean;
    label: string;
    tone?: UiTone;
  };
};

export function AdminAccessToggleSection({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: WorkspaceAccessToggle[];
}) {
  return (
    <SettingsSection title={title} description={description} presentation="compact">
      {items.map((item) => {
        const disabled = Boolean(item.disabled);
        return (
          <SettingsItem
            key={item.ariaLabel}
            title={item.title}
            help={item.description}
            compact
            action={
              <SettingsToggleAction
                checked={item.checked}
                disabled={disabled}
                onChange={item.onChange}
                ariaLabel={item.ariaLabel}
                badge={item.badge}
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}

export function WorkspaceAccessSection({
  description,
  cephAdmin,
  storageOps,
}: {
  description: string;
  cephAdmin: WorkspaceAccessToggle;
  storageOps: WorkspaceAccessToggle;
}) {
  return (
    <AdminAccessToggleSection
      title="Mass management workspaces"
      description={description}
      items={[cephAdmin, storageOps]}
    />
  );
}

export function BrowserAccessSection({
  checked,
  onChange,
  description = "Configure Browser features for this admin subject.",
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
}) {
  return (
    <AdminAccessToggleSection
      title="Browser"
      description={description}
      items={[{
        title: "Technical S3 tools",
        description: "Adds versions, metadata, batch operations, and bucket maintenance tools to /browser. Display density (rows and action toolbar) and optional panels remain personal choices for every Browser user.",
        checked,
        onChange,
        ariaLabel: "Enable technical S3 tools",
      }]}
    />
  );
}

export function ManagerToolAccessSection({
  title,
  description,
  tools,
  access,
  onChange,
  isToolDisabled,
  additionalItems = [],
  eligible = true,
  inheritedAccess,
}: {
  title: string;
  description: string;
  tools: ManagerToolDefinition[];
  access?: ManagerToolAccess | null;
  onChange: (key: ManagerToolKey, value: boolean) => void;
  isToolDisabled?: (tool: ManagerToolDefinition) => boolean;
  additionalItems?: WorkspaceAccessToggle[];
  eligible?: boolean;
  inheritedAccess?: ManagerToolAccess | null;
}) {
  const normalizedAccess = normalizeManagerToolAccess(access);
  return (
    <AdminAccessToggleSection
      title={title}
      description={description}
      items={[...additionalItems.map(item => ({ ...item,
        description: `${item.description} Direct grants add to Group and platform grants; removing this grant does not revoke another source.`,
        badge: eligible && item.platformDefault ? { visible: true, label: "Enabled by platform", tone: "neutral" as const }
          : eligible && item.inherited && !item.checked ? { visible: true, label: "Enabled by group", tone: "neutral" as const } : item.badge,
      })), ...tools.map<WorkspaceAccessToggle>((tool) => ({
        title: tool.title,
        description: `${tool.description} Direct grants add to Group and platform grants; removing this grant does not revoke another source. Eligible UI roles and storage access are still required.`,
        checked: eligible && Boolean(normalizedAccess[tool.key]),
        disabled: !eligible || (isToolDisabled ? isToolDisabled(tool) : !tool.enabled),
        onChange: (value) => onChange(tool.key, value),
        ariaLabel: tool.title,
        badge: { visible: !tool.enabled || eligible && (tool.platformDefault || Boolean(inheritedAccess?.[tool.key]) && !normalizedAccess[tool.key]),
          label: !tool.enabled ? "Disabled globally" : tool.platformDefault ? "Enabled by platform" : "Enabled by group", tone: "neutral" },
      }))]}
    />
  );
}
