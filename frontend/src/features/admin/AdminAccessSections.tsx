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
import { useAdminI18n } from "./adminI18n";

type WorkspaceAccessToggle = {
  checked: boolean;
  disabled?: boolean;
  blocked?: boolean;
  eligible?: boolean;
  title: string;
  description?: string;
  ariaLabel: string;
  onChange: (value: boolean) => void;
  platformDefault?: boolean;
  inherited?: boolean;
  effectiveAccessPresentation?: "detailed" | "exceptions-only" | "none";
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
  const { text: adminText } = useAdminI18n();
  return (
    <SettingsSection title={title} description={description} presentation="compact">
      {items.map((item) => {
        const disabled = Boolean(item.disabled || (item.blocked && !item.checked));
        const presentation = item.effectiveAccessPresentation;
        const effective: WorkspaceAccessToggle["effective"] = item.effective ?? (() => {
          if (!presentation || presentation === "none") return undefined;
          if (item.blocked) {
            return {
              state: "unavailable" as const,
              stateLabel: adminText("Unavailable"),
              sourceLabel: adminText("Platform"),
              localLabel: presentation === "detailed" ? adminText("Direct grant") : undefined,
            };
          }
          if (item.eligible === false) {
            return {
              state: "unavailable" as const,
              stateLabel: adminText("Unavailable"),
              sourceLabel: adminText("Role required"),
              localLabel: presentation === "detailed" ? adminText("Direct grant") : undefined,
            };
          }
          if (item.platformDefault) {
            return {
              state: "enabled" as const,
              stateLabel: adminText("Enabled"),
              sourceLabel: adminText("Platform"),
              localLabel: presentation === "detailed" ? adminText("Direct grant") : undefined,
            };
          }
          if (presentation === "exceptions-only") return undefined;
          if (item.checked) {
            return {
              state: "enabled" as const,
              stateLabel: adminText("Enabled"),
              sourceLabel: adminText("Direct"),
              localLabel: adminText("Direct grant"),
            };
          }
          if (item.inherited) {
            return {
              state: "enabled" as const,
              stateLabel: adminText("Enabled"),
              sourceLabel: adminText("Group"),
              localLabel: adminText("Direct grant"),
            };
          }
          return {
            state: "disabled" as const,
            stateLabel: adminText("Disabled"),
            sourceLabel: adminText("No grant"),
            localLabel: adminText("Direct grant"),
          };
        })();
        return (
          <SettingsItem
            key={item.ariaLabel}
            title={item.title}
            help={item.description}
            compact
            className={effective ? "settings-effective-row" : undefined}
            action={
              effective ? (
                <SettingsEffectiveAction
                  state={effective.state}
                  stateLabel={effective.stateLabel}
                  sourceLabel={effective.sourceLabel}
                  localLabel={effective.localLabel}
                  constraintLabel={effective.constraintLabel}
                  savedLabel={effective.savedLabel}
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
  const { text: adminText } = useAdminI18n();
  return (
    <AdminAccessToggleSection
      title={adminText("Mass management workspaces")}
      description={description}
      items={[cephAdmin, storageOps]}
    />
  );
}

export function BrowserAccessSection({
  checked,
  onChange,
  description = "Configure Browser features for this admin subject.",
  inherited = false,
  effectiveAccessPresentation,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  inherited?: boolean;
  effectiveAccessPresentation?: "detailed" | "exceptions-only" | "none";
}) {
  const { text: adminText } = useAdminI18n();
  return (
    <AdminAccessToggleSection
      title={adminText("Browser")}
      description={adminText(description)}
      items={[{
        title: adminText("Technical S3 tools"),
        description: adminText("Adds versions, metadata, batch operations, and bucket maintenance tools to /browser. Display density (rows and action toolbar) and optional panels remain personal choices for every Browser user."),
        checked,
        inherited,
        effectiveAccessPresentation,
        onChange,
        ariaLabel: adminText("Enable technical S3 tools"),
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
  effectiveAccessPresentation = "detailed",
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
  effectiveAccessPresentation?: "detailed" | "exceptions-only" | "none";
}) {
  const { text: adminText } = useAdminI18n();
  const normalizedAccess = normalizeManagerToolAccess(access);
  const sectionDescription = `${description} ${adminText("Grants are additive with platform and group grants; removing one source does not revoke another. Eligible UI roles and storage access are still required.")}`;
  return (
    <AdminAccessToggleSection
      title={title}
      description={sectionDescription}
      items={[
        ...additionalItems.map((item) => {
          return {
            ...item,
            eligible,
            effectiveAccessPresentation,
          };
        }),
        ...tools.map<WorkspaceAccessToggle>((tool) => {
          const direct = Boolean(normalizedAccess[tool.key]);
          const blocked = !tool.enabled;
          return {
            title: adminText(tool.title),
            checked: direct,
            blocked,
            eligible,
            effectiveAccessPresentation,
            disabled: !eligible || Boolean(tool.enabled && isToolDisabled?.(tool)),
            onChange: (value) => onChange(tool.key, value),
            ariaLabel: adminText(tool.title),
            platformDefault: tool.platformDefault,
            inherited: Boolean(inheritedAccess?.[tool.key]),
          };
        }),
      ]}
    />
  );
}
