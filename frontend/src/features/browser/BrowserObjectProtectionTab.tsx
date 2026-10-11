/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { PresignedUrl } from "../../api/browserTransfers";
import { SettingsButton } from "../../components/settings/SettingsControls";
import SettingsOperationSection from "../../components/settings/SettingsOperationSection";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import { aclOptions } from "./browserConstants";
import { OBJECT_LOCK_DISABLED_MESSAGE } from "./browserObjectDetailsModel";
import type { ObjectRetentionMode } from "./useBrowserObjectProtection";
import { useBrowserI18n } from "./browserI18n";

type BrowserObjectProtectionTabProps = {
  aclValue: string;
  legalHoldError: string | null;
  legalHoldStatus: "ON" | "OFF";
  objectLockUnavailable: boolean;
  onAclChange: (value: string) => void;
  onCopyPresign: () => Promise<void> | void;
  onGeneratePresign: () => Promise<void> | void;
  onLegalHoldStatusChange: (value: "ON" | "OFF") => void;
  onPresignExpiresChange: (value: string) => void;
  onRetentionBypassChange: (value: boolean) => void;
  onRetentionDateChange: (value: string) => void;
  onRetentionModeChange: (value: ObjectRetentionMode) => void;
  onSaveAcl: () => Promise<void> | void;
  onSaveLegalHold: () => Promise<void> | void;
  onSaveRetention: () => Promise<void> | void;
  presignError: string | null;
  presignExpires: string;
  presignHeaders?: PresignedUrl["headers"] | null;
  presignMethod: string;
  presignUrl: string;
  protectionLoading: boolean;
  retentionBypass: boolean;
  retentionDate: string;
  retentionError: string | null;
  retentionMode: ObjectRetentionMode;
  savingAcl: boolean;
  savingLegalHold: boolean;
  savingPresign: boolean;
  savingRetention: boolean;
  sseCustomerKeyActive: boolean;
};

export default function BrowserObjectProtectionTab({
  aclValue, legalHoldError, legalHoldStatus, objectLockUnavailable, onAclChange,
  onCopyPresign, onGeneratePresign, onLegalHoldStatusChange, onPresignExpiresChange,
  onRetentionBypassChange, onRetentionDateChange, onRetentionModeChange, onSaveAcl,
  onSaveLegalHold, onSaveRetention, presignError, presignExpires, presignHeaders,
  presignMethod, presignUrl, protectionLoading, retentionBypass, retentionDate,
  retentionError, retentionMode, savingAcl, savingLegalHold, savingPresign,
  savingRetention, sseCustomerKeyActive,
}: BrowserObjectProtectionTabProps) {
  const { text } = useBrowserI18n();
  const protectionDisabled = protectionLoading || objectLockUnavailable;
  return (
    <div className="settings-compact settings-form">
      <SettingsOperationSection title={text("Access")} description={text("Updating the ACL overrides any custom grants currently applied.")}
        busy={savingAcl} submitLabel={text("Save ACL")} onSubmit={onSaveAcl}>
        <UiSelect label={text("Canned ACL")} value={aclValue} onChange={(event) => onAclChange(event.target.value)}>
          {aclOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </UiSelect>
      </SettingsOperationSection>
      <SettingsOperationSection title={text("Legal hold")} busy={savingLegalHold} disabled={protectionDisabled}
        submitLabel={text("Update legal hold")} onSubmit={onSaveLegalHold}>
        {protectionLoading && <p className="settings-description" role="status">{text("Loading legal hold...")}</p>}
        {legalHoldError && <UiInlineMessage tone="error" role="alert">{legalHoldError}</UiInlineMessage>}
        {objectLockUnavailable && <UiInlineMessage tone="info">{text(OBJECT_LOCK_DISABLED_MESSAGE)}</UiInlineMessage>}
        <UiSelect label={text("Legal hold status")} value={legalHoldStatus}
          onChange={(event) => onLegalHoldStatusChange(event.target.value as "ON" | "OFF")}>
          <option value="OFF">{text("OFF")}</option><option value="ON">{text("ON")}</option>
        </UiSelect>
      </SettingsOperationSection>
      <SettingsOperationSection title={text("Retention")} busy={savingRetention} disabled={protectionDisabled}
        submitDisabled={!retentionMode || !retentionDate} submitLabel={text("Update retention")} onSubmit={onSaveRetention}>
        {protectionLoading && <p className="settings-description" role="status">{text("Loading retention...")}</p>}
        {retentionError && <UiInlineMessage tone="error" role="alert">{retentionError}</UiInlineMessage>}
        {objectLockUnavailable && <UiInlineMessage tone="info">{text(OBJECT_LOCK_DISABLED_MESSAGE)}</UiInlineMessage>}
        <div className="settings-fields sm:grid-cols-2">
          <UiSelect label={text("Mode")} value={retentionMode}
            onChange={(event) => onRetentionModeChange(event.target.value as ObjectRetentionMode)}>
            <option value="">{text("Select mode")}</option><option value="GOVERNANCE">GOVERNANCE</option><option value="COMPLIANCE">COMPLIANCE</option>
          </UiSelect>
          <UiInput label={text("Retain until")} type="datetime-local" value={retentionDate}
            onChange={(event) => onRetentionDateChange(event.target.value)} />
        </div>
        <UiCheckboxField className="settings-choice" checked={retentionBypass}
          onChange={(event) => onRetentionBypassChange(event.target.checked)}>{text("Bypass governance retention")}</UiCheckboxField>
      </SettingsOperationSection>
      <SettingsOperationSection title={text("Signed URL")} description={text("Generate a temporary signed URL for this object (valid for up to 12 hours).")}
        busy={savingPresign} submitLabel={text("Generate URL")} busyLabel={text("Generating...")} onSubmit={onGeneratePresign}>
        {sseCustomerKeyActive && <UiInlineMessage tone="warning">
          {text("SSE-C is active: URL alone is insufficient without the required SSE-C headers.")}</UiInlineMessage>}
        <UiInput label={text("Expires at")} type="datetime-local" value={presignExpires}
          onChange={(event) => onPresignExpiresChange(event.target.value)} />
        {presignError && <UiInlineMessage tone="error" role="alert">{presignError}</UiInlineMessage>}
        {presignUrl && <div className="settings-stack">
          <UiTextarea label={text("Signed URL")} hint={text("HTTP method: {method}", { method: presignMethod || "GET" })} rows={3}
            readOnly value={presignUrl} spellCheck={false} className="font-mono" />
          <div><SettingsButton variant="secondary" onClick={() => void onCopyPresign()}>{text("Copy URL")}</SettingsButton></div>
          {presignHeaders && Object.keys(presignHeaders).length > 0 && (
            <UiTextarea label={text("Required headers")} rows={3} readOnly value={JSON.stringify(presignHeaders, null, 2)}
              spellCheck={false} className="font-mono" />
          )}
        </div>}
      </SettingsOperationSection>
    </div>
  );
}
