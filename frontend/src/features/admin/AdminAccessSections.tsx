import type { ManagerToolAccess } from "../../api/users";
import {
  SettingsEffectiveAction,
  SettingsItem,
  SettingsSection,
  SettingsSwitch,
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
  blocked?: boolean;
  title: string;
  description?: string;
  ariaLabel: string;
  onChange: (value: boolean) => void;
  platformDefault?: boolean;
  inherited?: boolean;
  badge?: {
    visible?: boolean;
    label: string;
    tone?: UiTone;
  };
  effective?: {
    state: "enabled" | "disabled" | "unavailable";
    stateLabel: string;
    sourceLabel?: string;
    localLabel?: string;
    constraintLabel?: string;
    savedLabel?: string;
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
        const disabled = Boolean(item.disabled || (item.blocked && !item.checked));
        return (
          <SettingsItem
            key={item.ariaLabel}
            title={item.title}
            help={item.description}
            compact
            className={item.effective ? "settings-effective-row" : undefined}
            action={
              item.effective ? (
                <SettingsEffectiveAction
                  state={item.effective.state}
                  stateLabel={item.effective.stateLabel}
                  sourceLabel={item.effective.sourceLabel}
                  localLabel={item.effective.localLabel}
                  constraintLabel={item.effective.constraintLabel}
                  savedLabel={item.effective.savedLabel}
                >
                  <SettingsSwitch
                    checked={item.checked}
                    disabled={disabled}
                    onChange={item.onChange}
                    ariaLabel={item.ariaLabel}
                  />
                </SettingsEffectiveAction>
              ) : (
                <SettingsToggleAction
                  checked={item.checked}
                  disabled={disabled}
                  onChange={item.onChange}
                  ariaLabel={item.ariaLabel}
                  badge={item.badge}
                />
              )
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
  const sectionDescription = `${description} Grants are additive with platform and group grants; removing one source does not revoke another. Eligible UI roles and storage access are still required.`;
  const effectiveGrant = ({
    direct,
    platformDefault,
    inherited,
    blocked,
  }: {
    direct: boolean;
    platformDefault: boolean;
    inherited: boolean;
    blocked: boolean;
  }): NonNullable<WorkspaceAccessToggle["effective"]> => {
    if (blocked) {
      return {
        state: "unavailable",
        stateLabel: "Unavailable",
        sourceLabel: "Platform",
        localLabel: "Direct grant",
      };
    }
    if (!eligible) {
      return {
        state: "unavailable",
        stateLabel: "Unavailable",
        sourceLabel: "Role required",
        localLabel: "Direct grant",
      };
    }
    if (platformDefault) {
      return {
        state: "enabled",
        stateLabel: "Enabled",
        sourceLabel: "Platform",
        localLabel: "Direct grant",
      };
    }
    if (direct) {
      return {
        state: "enabled",
        stateLabel: "Enabled",
        sourceLabel: "Direct",
        localLabel: "Direct grant",
      };
    }
    if (inherited) {
      return {
        state: "enabled",
        stateLabel: "Enabled",
        sourceLabel: "Group",
        localLabel: "Direct grant",
      };
    }
    return {
      state: "disabled",
      stateLabel: "Disabled",
      sourceLabel: "No grant",
      localLabel: "Direct grant",
    };
  };
  return (
    <AdminAccessToggleSection
      title={title}
      description={sectionDescription}
      items={[
        ...additionalItems.map((item) => {
          const direct = Boolean(item.checked);
          const blocked = Boolean(item.blocked);
          return {
            ...item,
            effective: effectiveGrant({
              direct,
              platformDefault: Boolean(item.platformDefault),
              inherited: Boolean(item.inherited) && !direct,
              blocked,
            }),
          };
        }),
        ...tools.map<WorkspaceAccessToggle>((tool) => {
          const direct = eligible && Boolean(normalizedAccess[tool.key]);
          const blocked = !tool.enabled;
          return {
            title: tool.title,
            checked: direct,
            blocked,
            disabled: !eligible || Boolean(tool.enabled && isToolDisabled?.(tool)),
            onChange: (value) => onChange(tool.key, value),
            ariaLabel: tool.title,
            effective: effectiveGrant({
              direct,
              platformDefault: tool.platformDefault,
              inherited: Boolean(inheritedAccess?.[tool.key]) && !direct,
              blocked,
            }),
          };
        }),
      ]}
    />
  );
}
