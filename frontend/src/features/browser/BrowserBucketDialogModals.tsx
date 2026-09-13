/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import { SettingsButton, SettingsDialog } from "../../components/settings/SettingsControls";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import SettingsForm from "../../components/settings/SettingsForm";
import { useSettingsFormController } from "../../components/settings/useSettingsFormController";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { stableSignature } from "../../utils/stableSignature";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiInput from "../../components/ui/UiInput";
import UiField from "../../components/ui/UiField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { uiInputClass } from "../../components/ui/styles";
import {
  S3_BUCKET_NAME_MAX_LENGTH,
  normalizeS3BucketNameInput,
} from "../../utils/s3BucketName";
import { BucketDetailContent } from "../manager/BucketDetailPage";
import { S3AccountProvider } from "../manager/S3AccountContext";
import { resolveSseCustomerKeyInputType } from "./sseCustomerKeyActions";
import DetailsDrawerShell from "../shared/DetailsDrawerShell";
import BrowserBucketDetailsContent from "./BrowserBucketDetailsContent";

type BrowserBucketConfigurationDrawerProps = {
  accountId: S3AccountSelector;
  bucketName: string;
  includeStaticWebsite: boolean;
  includeUsage: boolean;
  workspaceSurface: BrowserWorkspaceSurface;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type BrowserCreateBucketModalProps = {
  name: string;
  versioning: boolean;
  loading: boolean;
  error: string | null;
  isNameValid: boolean;
  invalidNameMessage: string;
  hasS3AccountContext: boolean;
  onNameChange: (value: string) => void;
  onVersioningChange: (enabled: boolean) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
};

type BrowserSseCustomerKeyModalProps = {
  dirty: boolean;
  value: string;
  visible: boolean;
  error: string | null;
  notice: string | null;
  active: boolean;
  canGenerate: boolean;
  onValueChange: (value: string) => void;
  onToggleVisibility: () => void;
  onGenerate: () => void | Promise<void>;
  onClear: () => void;
  onActivate: () => void;
  onClose: () => void;
};

type BrowserCreateFolderModalProps = {
  name: string;
  loading: boolean;
  error: string | null;
  currentPath: string;
  bucketName: string;
  hasS3AccountContext: boolean;
  onNameChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
};

export function BrowserBucketConfigurationDrawer({
  accountId,
  bucketName,
  includeStaticWebsite,
  includeUsage,
  workspaceSurface,
  onClose,
  onDirtyChange,
}: BrowserBucketConfigurationDrawerProps) {
  const [dirty, setDirty] = useState(false);
  const handleDirtyChange = useCallback(
    (nextDirty: boolean) => {
      setDirty(nextDirty);
      onDirtyChange?.(nextDirty);
    },
    [onDirtyChange],
  );
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: dirty,
    onClose,
    description: "You have unsaved bucket settings. Closing the drawer will discard them.",
  });
  const browserReadOnly = workspaceSurface === "browser";
  const content = (
    <BucketDetailContent
      mode={workspaceSurface === "ceph-admin" ? "ceph-admin" : "manager"}
      bucketNameOverride={bucketName}
      embedded
      hideObjectsTab
      onDirtyChange={handleDirtyChange}
    />
  );

  return (
    <DetailsDrawerShell
      title={bucketName}
      subtitle={
        <p className="ui-caption text-[var(--ui-text-muted)]">
          {browserReadOnly ? "Bucket details" : "Bucket settings"}
        </p>
      }
      onClose={closeGuard.requestClose}
    >
      {browserReadOnly ? (
        <BrowserBucketDetailsContent
          accountId={accountId}
          bucketName={bucketName}
          includeStaticWebsite={includeStaticWebsite}
          includeUsage={includeUsage}
        />
      ) : workspaceSurface === "manager" ? (
        content
      ) : (
        <S3AccountProvider scope="browser">{content}</S3AccountProvider>
      )}
      {closeGuard.confirmationDialog}
    </DetailsDrawerShell>
  );
}

export function BrowserCreateBucketModal({
  name, versioning, loading, error, isNameValid, invalidNameMessage,
  hasS3AccountContext, onNameChange, onVersioningChange, onSubmit, onClose,
}: BrowserCreateBucketModalProps) {
  return (
    <SettingsFormDialog title="Create bucket" draftKey={stableSignature({ name, versioning })}
      busy={loading} disabled={!hasS3AccountContext || !name.trim() || !isNameValid}
      error={error} submitLabel={loading ? "Creating..." : "Create bucket"}
      onSubmit={onSubmit} onClose={onClose}>
      <UiInput label="Bucket name" type="text" value={name}
        onChange={(event) => onNameChange(normalizeS3BucketNameInput(event.target.value))}
        placeholder="my-bucket" maxLength={S3_BUCKET_NAME_MAX_LENGTH}
        error={name && !isNameValid ? invalidNameMessage : undefined} spellCheck={false} />
      <UiCheckboxField className="settings-choice" checked={versioning}
        onChange={(event) => onVersioningChange(event.target.checked)}>
        Enable versioning
      </UiCheckboxField>
    </SettingsFormDialog>
  );
}

export function BrowserSseCustomerKeyModal({
  value, visible, error, notice, active, canGenerate, dirty,
  onValueChange, onToggleVisibility, onGenerate, onClear, onActivate, onClose,
}: BrowserSseCustomerKeyModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { labels, locked, requestClose, submit, runAction, confirmationDialog, navigationGuard } = useSettingsFormController({
    dirty, onSubmit: onActivate, onClose,
  });
  return <>
    <SettingsDialog title="SSE-C key" onClose={requestClose} closeDisabled={locked}
      closeOnBackdropClick={!locked} closeOnEscape={!locked} initialFocusRef={inputRef}
      closeLabel={labels.close} closeAriaLabel={labels.close}>
      <SettingsForm label="SSE-C key" presentation="dialog" busy={locked}
        onSubmit={submit} onCancel={requestClose} submitLabel="Enable" busyLabel="Enabling..."
        actions={<>
          <SettingsButton variant="secondary" disabled={locked} onClick={requestClose}>{labels.cancel}</SettingsButton>
          <SettingsButton variant="secondary" disabled={locked || !canGenerate} loading={locked}
            onClick={() => void runAction(onGenerate)}>Generate</SettingsButton>
          <SettingsButton variant="danger" disabled={locked || !active}
            onClick={() => void runAction(onClear)}>Clear</SettingsButton>
          <SettingsButton type="submit" disabled={locked}>Enable</SettingsButton>
        </>}>
        <p className="settings-description">
          Enter a base64 key that decodes to exactly 32 bytes. The key is stored
          in memory only for this browser session and this bucket.
        </p>
        <UiField label="Customer key (base64, 32 bytes)" error={error}>
          {({ id, describedBy, invalid }) => <div className="flex min-w-0 items-center gap-2">
            <input ref={inputRef} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}
              type={resolveSseCustomerKeyInputType(visible)} value={value}
              onChange={(event) => onValueChange(event.target.value)} placeholder="Base64 key"
              className={`${uiInputClass} min-w-0 flex-1`} spellCheck={false} />
            <SettingsButton variant="secondary" className="shrink-0" onClick={onToggleVisibility} aria-pressed={visible}>
              {visible ? "Hide" : "Show"}
            </SettingsButton>
          </div>}
        </UiField>
        {notice && <UiInlineMessage tone="warning" role="status">{notice}</UiInlineMessage>}
        {active && <UiInlineMessage tone="success">SSE-C is currently enabled for this bucket.</UiInlineMessage>}
      </SettingsForm>
    </SettingsDialog>
    {confirmationDialog}
    {navigationGuard}
  </>;
}

export function BrowserCreateFolderModal({
  name, loading, error, currentPath, bucketName, hasS3AccountContext,
  onNameChange, onSubmit, onClose,
}: BrowserCreateFolderModalProps) {
  return (
    <SettingsFormDialog title="Create folder" draftKey={name} busy={loading}
      disabled={!bucketName || !hasS3AccountContext} error={error}
      submitLabel={loading ? "Creating..." : "Create"} onSubmit={onSubmit} onClose={onClose}
      maxWidthClass="max-w-md">
      <p className="settings-description break-all whitespace-pre-wrap">Destination: {currentPath || `${bucketName}/`}</p>
      <UiInput label="Folder name" type="text" value={name}
        onChange={(event) => onNameChange(event.target.value)} placeholder="my-folder" spellCheck={false} />
    </SettingsFormDialog>
  );
}
