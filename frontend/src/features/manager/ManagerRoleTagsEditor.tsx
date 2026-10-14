/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { IAMTag } from "../../api/managerIamRoles";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import { useManagerI18n } from "./managerI18n";

export function roleTagKeyError(value: string): string | undefined {
  if (!value) return "Tag key is required.";
  if (value.length > 128) return "Tag key must be at most 128 characters.";
  return undefined;
}

export function roleTagValueError(value: string): string | undefined {
  if (value.length > 256) return "Tag value must be at most 256 characters.";
  return undefined;
}

export function roleTagError(tag: IAMTag): string | undefined {
  return roleTagKeyError(tag.key) ?? roleTagValueError(tag.value);
}

export default function ManagerRoleTagsEditor({ tags, onChange }: { tags: IAMTag[]; onChange: (tags: IAMTag[]) => void }) {
  const { text } = useManagerI18n();
  const update = (index: number, field: "key" | "value", value: string) => {
    onChange(tags.map((tag, position) => position === index ? { ...tag, [field]: value } : tag));
  };
  return <SettingsSection title={text("Role tags")} description={text("Native IAM tags attached to this role.")} presentation="compact">
    <div className="settings-stack">
      {tags.length === 0 && <p className="settings-description">{text("No role tags.")}</p>}
      {tags.map((tag, index) => {
        const keyError = roleTagKeyError(tag.key);
        const valueError = roleTagValueError(tag.value);
        return <div key={`role-tag-${index}`} className="settings-fields md:grid-cols-[1fr_1fr_auto]">
          <UiInput label={text("Tag key")} value={tag.key} onChange={(event) => update(index, "key", event.target.value)} error={keyError ? text(keyError) : undefined} />
          <UiInput label={text("Tag value")} value={tag.value} onChange={(event) => update(index, "value", event.target.value)} error={valueError ? text(valueError) : undefined} />
          <div className="flex items-end"><SettingsButton variant="secondary" onClick={() => onChange(tags.filter((_, position) => position !== index))}>{text("Remove")}</SettingsButton></div>
        </div>;
      })}
      <div><SettingsButton variant="secondary" onClick={() => onChange([...tags, { key: "", value: "" }])} disabled={tags.length >= 50}>{text("Add tag")}</SettingsButton></div>
    </div>
  </SettingsSection>;
}
