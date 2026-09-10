/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "../../components/ModalActions";
import { useCallback, useState, type ReactNode, type RefObject } from "react";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import Modal from "../../components/Modal";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiButton from "../../components/ui/UiButton";
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
  confirmationDialog: ReactNode;
  onNameChange: (value: string) => void;
  onVersioningChange: (enabled: boolean) => void;
  onSubmit: () => void;
  onClose: () => void;
};

type BrowserSseCustomerKeyModalProps = {
  value: string;
  visible: boolean;
  error: string | null;
  notice: string | null;
  active: boolean;
  canGenerate: boolean;
  confirmationDialog: ReactNode;
  onValueChange: (value: string) => void;
  onToggleVisibility: () => void;
  onGenerate: () => void;
  onClear: () => void;
  onActivate: () => void;
  onClose: () => void;
};

type BrowserCreateFolderModalProps = {
  inputRef: RefObject<HTMLInputElement>;
  name: string;
  loading: boolean;
  error: string | null;
  currentPath: string;
  bucketName: string;
  hasS3AccountContext: boolean;
  confirmationDialog: ReactNode;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
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
  name,
  versioning,
  loading,
  error,
  isNameValid,
  invalidNameMessage,
  hasS3AccountContext,
  confirmationDialog,
  onNameChange,
  onVersioningChange,
  onSubmit,
  onClose,
}: BrowserCreateBucketModalProps) {
  return (
    <Modal title="Create bucket" onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <UiInput
          label="Bucket name"
          type="text"
          value={name}
          onChange={(event) =>
            onNameChange(normalizeS3BucketNameInput(event.target.value))
          }
          placeholder="my-bucket"
          maxLength={S3_BUCKET_NAME_MAX_LENGTH}
          error={name && !isNameValid ? invalidNameMessage : undefined}
          disabled={loading}
          spellCheck={false}
          autoFocus
        />
        <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={versioning}
            onChange={(event) => onVersioningChange(event.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/40 dark:border-slate-600 dark:bg-slate-800"
          />
          Enable versioning
        </label>
        {error && (
          <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>
        )}
        <ModalActions>
          <UiButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </UiButton>
          <UiButton
            type="submit"
            size="sm"
            disabled={
              !hasS3AccountContext || loading || !name.trim() || !isNameValid
            }
          >
            {loading ? "Creating..." : "Create bucket"}
          </UiButton>
        </ModalActions>
      </form>
      {confirmationDialog}
    </Modal>
  );
}

export function BrowserSseCustomerKeyModal({
  value,
  visible,
  error,
  notice,
  active,
  canGenerate,
  confirmationDialog,
  onValueChange,
  onToggleVisibility,
  onGenerate,
  onClear,
  onActivate,
  onClose,
}: BrowserSseCustomerKeyModalProps) {
  return (
    <Modal title="SSE-C key" onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onActivate();
        }}
      >
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Enter a base64 key that decodes to exactly 32 bytes. The key is stored
          in memory only for this browser session and this bucket.
        </p>
        <UiField label="Customer key (base64, 32 bytes)" error={error}>
          {({ id, describedBy, invalid }) => <div className="flex min-w-0 items-center gap-2">
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              type={resolveSseCustomerKeyInputType(visible)}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder="Base64 key"
              className={`${uiInputClass} min-w-0 flex-1`}
              spellCheck={false}
              autoFocus
            />
            <UiButton
              type="button"
              variant="secondary"
              size="md"
              className="shrink-0"
              onClick={onToggleVisibility}
            >
              {visible ? "Hide" : "Show"}
            </UiButton>
          </div>}
        </UiField>
        {notice && (
          <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
            {notice}
          </p>
        )}
        {active && (
          <p className="ui-caption font-semibold text-emerald-700 dark:text-emerald-200">
            SSE-C is currently enabled for this bucket.
          </p>
        )}
        <ModalActions>
          <UiButton type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </UiButton>
          <UiButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={onGenerate}
            disabled={!canGenerate}
          >
            Generate
          </UiButton>
          <UiButton
            type="button"
            variant="danger"
            size="sm"
            onClick={onClear}
            disabled={!active}
          >
            Clear
          </UiButton>
          <UiButton type="submit" size="sm">
            Enable
          </UiButton>
        </ModalActions>
      </form>
      {confirmationDialog}
    </Modal>
  );
}

export function BrowserCreateFolderModal({
  inputRef,
  name,
  loading,
  error,
  currentPath,
  bucketName,
  hasS3AccountContext,
  confirmationDialog,
  onNameChange,
  onSubmit,
  onClose,
}: BrowserCreateFolderModalProps) {
  return (
    <Modal
      title="Create folder"
      onClose={onClose}
      maxWidthClass="max-w-md"
      initialFocusRef={inputRef}
      closeOnBackdropClick={!loading}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Destination:{" "}
          <span className="font-semibold">
            {currentPath || `${bucketName}/`}
          </span>
        </p>
        <UiInput
          label="Folder name"
          ref={inputRef}
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="my-folder"
          disabled={loading}
          spellCheck={false}
        />
        {error && (
          <UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage>
        )}
        <ModalActions>
          <UiButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </UiButton>
          <UiButton
            type="submit"
            size="sm"
            disabled={!bucketName || !hasS3AccountContext || loading}
          >
            {loading ? "Creating..." : "Create"}
          </UiButton>
        </ModalActions>
      </form>
      {confirmationDialog}
    </Modal>
  );
}
