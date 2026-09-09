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

const adminModalSettingsGroupClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-4";

const adminSettingsItemSurfaceClass = (disabled: boolean) =>
  disabled ? "bg-[var(--ui-surface-muted)] opacity-75" : "bg-[var(--ui-surface)]";

type WorkspaceAccessToggle = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  ariaLabel: string;
  onChange: (value: boolean) => void;
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
    <div className={adminModalSettingsGroupClass}>
      <SettingsSection title={title} description={description} layout="stack">
        {items.map((item) => {
          const disabled = Boolean(item.disabled);
          return (
            <SettingsItem
              key={item.ariaLabel}
              title={item.title}
              description={item.description}
              className={adminSettingsItemSurfaceClass(disabled)}
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
    </div>
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
    <div className={adminModalSettingsGroupClass}>
      <SettingsSection title="Browser" description={description} layout="stack">
        <SettingsItem
          title="Technical S3 tools"
          description="Adds versions, metadata, batch operations, and bucket maintenance tools to /browser. Display density (rows and action toolbar) and optional panels remain personal choices for every Browser user."
          className={adminSettingsItemSurfaceClass(false)}
          action={
            <SettingsToggleAction
              checked={checked}
              onChange={onChange}
              ariaLabel="Enable technical S3 tools"
            />
          }
        />
      </SettingsSection>
    </div>
  );
}

export function ManagerToolAccessSection({
  title,
  description,
  tools,
  access,
  onChange,
  isToolDisabled,
}: {
  title: string;
  description: string;
  tools: ManagerToolDefinition[];
  access?: ManagerToolAccess | null;
  onChange: (key: ManagerToolKey, value: boolean) => void;
  isToolDisabled?: (tool: ManagerToolDefinition) => boolean;
}) {
  const normalizedAccess = normalizeManagerToolAccess(access);
  return (
    <div className={adminModalSettingsGroupClass}>
      <SettingsSection title={title} description={description} layout="stack">
        {tools.map((tool) => {
          const disabled = isToolDisabled ? isToolDisabled(tool) : !tool.enabled;
          return (
            <SettingsItem
              key={tool.key}
              title={tool.title}
              description={tool.description}
              className={adminSettingsItemSurfaceClass(disabled)}
              action={
                <SettingsToggleAction
                  checked={Boolean(normalizedAccess[tool.key])}
                  disabled={disabled}
                  onChange={(value) => onChange(tool.key, value)}
                  ariaLabel={tool.title}
                  badge={{ visible: !tool.enabled, label: "Disabled globally", tone: "neutral" }}
                />
              }
            />
          );
        })}
      </SettingsSection>
    </div>
  );
}
