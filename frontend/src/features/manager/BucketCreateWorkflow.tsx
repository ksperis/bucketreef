/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState, type FormEvent } from "react";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { isValidS3BucketName, normalizeS3BucketName, normalizeS3BucketNameInput, S3_BUCKET_NAME_MAX_LENGTH } from "../../utils/s3BucketName";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";

type BucketCreateWorkflowProps = {
  contextLabel: string;
  needsContext: boolean;
  busy: boolean;
  error: string | null;
  onCreate: (name: string, versioning: boolean, locationConstraint?: string) => Promise<{ created: boolean }>;
  onClose: () => void;
};

/** All initial bucket settings share one draft, submit action and navigation guard. */
export default function BucketCreateWorkflow({ contextLabel, needsContext, busy, error, onCreate, onClose }: BucketCreateWorkflowProps) {
  const { text } = useManagerI18n();
  const [name, setName] = useState("");
  const [customLocation, setCustomLocation] = useState(false);
  const [location, setLocation] = useState("");
  const [versioning, setVersioning] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const normalizedName = normalizeS3BucketName(name);
  const nameError = !normalizedName
    ? validationAttempted ? text("Bucket name is required.") : undefined
    : !isValidS3BucketName(normalizedName)
      ? text("Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.")
      : undefined;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    setValidationAttempted(true);
    if (!normalizedName || nameError) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    const result = await onCreate(normalizedName, versioning, customLocation ? location.trim() || undefined : undefined);
    if (result.created) onClose();
  };

  return <SettingsWorkflowForm title={text("Create bucket")}
    description={text("Define the bucket identity and initial protection settings for the active manager context.")}
    breadcrumbs={managerPageBreadcrumbs(text, "buckets", { label: text("Create") })} backLabel={text("Back to buckets")}
    contentVariant="plain" dirty={Boolean(name || customLocation || location || versioning)} busy={busy}
    disabled={needsContext} error={error} onSubmit={submit} onClose={onClose}
    submitLabel={text("Create bucket")} busyLabel={text("Creating...")}>
    <p className="settings-description [overflow-wrap:anywhere]">{text("Context:")} {contextLabel}</p>
    <SettingsSection title={text("General")} presentation="compact">
      <div className="settings-fields">
        <UiInput label={text("Bucket name")} required value={name} maxLength={S3_BUCKET_NAME_MAX_LENGTH}
          placeholder={text("ex: backups-prod")} error={nameError} spellCheck={false}
          hint={text("DNS compatible, lowercase, numbers, dots, and hyphens.")}
          onChange={event => setName(normalizeS3BucketNameInput(event.target.value))} />
        <SettingsItem compact title={text("Custom LocationConstraint")}
          description={text("Use a specific region or placement instead of the endpoint default.")}
          action={<SettingsSwitch checked={customLocation} onChange={setCustomLocation} ariaLabel={text("Custom LocationConstraint")} />}>
          {customLocation && <UiInput label={text("LocationConstraint")} value={location} placeholder={text("ex: eu-west-1")}
            hint={text("Optional. Empty value uses the endpoint default region/placement.")}
            onChange={event => setLocation(event.target.value)} />}
        </SettingsItem>
      </div>
    </SettingsSection>
    <SettingsSection title={text("Protection")} presentation="compact">
      <SettingsItem compact title={text("Versioning")} description={text("Enables version retention.")}
        action={<SettingsSwitch checked={versioning} onChange={setVersioning} ariaLabel={text("Versioning")} />} />
    </SettingsSection>
  </SettingsWorkflowForm>;
}
