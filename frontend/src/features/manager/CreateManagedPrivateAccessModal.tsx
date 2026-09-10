/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "../../components/ModalActions";
import { FormEvent, useMemo, useRef, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import type { IAMGroup } from "../../api/managerIamGroups";
import type { IamPolicy } from "../../api/managerIamPolicies";
import {
  createManagedIAMPrivateAccess,
  createManagedRGWUserPrivateAccess,
  type ManagedInlinePolicy,
} from "../../api/managedPrivateAccess";
import { SettingsButton, SettingsDialog, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiDetails from "../../components/ui/UiDetails";
import S3ConnectionAccessFields from "../shared/S3ConnectionAccessFields";
import { extractApiError } from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";

const AMAZON_S3_FULL_ACCESS_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonS3FullAccess";

const INLINE_POLICY_TEMPLATE = '{\n  "Version": "2012-10-17",\n  "Statement": []\n}';

type Props = {
  variant: "iam" | "rgw_user";
  accountId: S3AccountSelector;
  contextName?: string | null;
  groups?: IAMGroup[];
  policies?: IamPolicy[];
  onClose: () => void;
  onCreated: (connectionName: string) => void;
};

export default function CreateManagedPrivateAccessModal({
  variant,
  accountId,
  contextName,
  groups = [],
  policies = [],
  onClose,
  onCreated,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const connectionNameRef = useRef<HTMLInputElement | null>(null);
  const [initialConnectionName] = useState(() => {
    const normalizedContextName = contextName?.trim();
    return normalizedContextName ? `${normalizedContextName} private access` : "My private access";
  });
  const [connectionName, setConnectionName] = useState(initialConnectionName);
  const [accessBrowser, setAccessBrowser] = useState(true);
  const [accessManager, setAccessManager] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>(
    variant === "iam" ? [AMAZON_S3_FULL_ACCESS_POLICY_ARN] : []
  );
  const [inlinePolicies, setInlinePolicies] = useState<ManagedInlinePolicy[]>([]);
  const [inlineName, setInlineName] = useState("");
  const [inlineDocument, setInlineDocument] = useState(INLINE_POLICY_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [inlineNameError, setInlineNameError] = useState<string>();
  const [inlineDocumentError, setInlineDocumentError] = useState<string>();
  const [accessError, setAccessError] = useState<string>();

  const title = variant === "iam" ? "Create my private access" : "Create my private RGW access";
  const selectedInlineNames = useMemo(() => new Set(inlinePolicies.map((policy) => policy.name)), [inlinePolicies]);
  const availablePolicies = useMemo(
    () => policies.some((policy) => policy.arn === AMAZON_S3_FULL_ACCESS_POLICY_ARN)
      ? policies
      : [
          { name: "AmazonS3FullAccess", arn: AMAZON_S3_FULL_ACCESS_POLICY_ARN },
          ...policies,
        ],
    [policies]
  );
  const usesDefaultConfiguration = accessBrowser
    && !accessManager
    && (
      variant === "rgw_user"
      || (
        selectedGroups.length === 0
        && selectedPolicies.length === 1
        && selectedPolicies[0] === AMAZON_S3_FULL_ACCESS_POLICY_ARN
        && inlinePolicies.length === 0
      )
    );

  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges: connectionName !== initialConnectionName || !usesDefaultConfiguration
      || (variant === "iam" && (inlineName !== "" || inlineDocument !== INLINE_POLICY_TEMPLATE)),
    disabled: busy,
    onClose,
  });

  const focusInvalidField = () => {
    if (formRef.current) focusFirstInvalidField(formRef.current);
  };

  const addInlinePolicy = () => {
    if (busy) return;
    setInlineNameError(undefined);
    setInlineDocumentError(undefined);
    const name = inlineName.trim();
    if (!name) {
      setInlineNameError("Inline policy name is required.");
      focusInvalidField();
      return;
    }
    if (selectedInlineNames.has(name)) {
      setInlineNameError("Inline policy names must be unique.");
      focusInvalidField();
      return;
    }
    try {
      const parsed = JSON.parse(inlineDocument) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid");
      }
      setInlinePolicies((current) => [...current, { name, document: parsed as Record<string, unknown> }]);
      setInlineName("");
      setError(null);
    } catch {
      setInlineDocumentError("Inline policy document must be a JSON object.");
      focusInvalidField();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const missingName = !connectionName.trim();
    const missingAccess = !accessBrowser && !accessManager;
    setNameError(missingName ? "Connection name is required." : undefined);
    setAccessError(missingAccess ? "Enable Browser, Manager, or both." : undefined);
    if (missingName || missingAccess) {
      const details = formRef.current?.querySelector("details");
      if (missingAccess && details) details.open = true;
      focusInvalidField();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = {
        connection_name: connectionName.trim(),
        access_browser: accessBrowser,
        access_manager: accessManager,
      };
      const result = variant === "iam"
        ? await createManagedIAMPrivateAccess(accountId, {
            ...base,
            groups: selectedGroups,
            managed_policies: selectedPolicies,
            inline_policies: inlinePolicies,
          })
        : await createManagedRGWUserPrivateAccess(accountId, base);
      notifyExecutionContextsRefresh();
      onCreated(result.connection.name);
      onClose();
    } catch (err) {
      setError(extractApiError(err, "Unable to create managed private access."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      title={title}
      onClose={closeGuard.requestClose}
      closeDisabled={busy}
      maxWidthClass="max-w-3xl"
      initialFocusRef={connectionNameRef}
    >
      <form ref={formRef} className="settings-form" onSubmit={submit} noValidate>
        <fieldset disabled={busy} className="settings-stack min-w-0">
          {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
          <UiInlineMessage tone="info">
            {variant === "iam"
              ? usesDefaultConfiguration
                ? "BucketReef creates a dedicated IAM user with AmazonS3FullAccess and a private connection for Browser. The generated secret is stored only on the server and is never sent to this browser."
                : "BucketReef creates a dedicated IAM user and private connection using the advanced configuration below. The generated secret is stored only on the server and is never sent to this browser."
              : usesDefaultConfiguration
                ? "BucketReef creates a new access key for this RGW user and stores it in a private connection for Browser. The generated secret is stored only on the server and is never sent to this browser."
                : "BucketReef creates a new access key for this RGW user and stores it in a private connection using the advanced configuration below. The generated secret is stored only on the server and is never sent to this browser."}
          </UiInlineMessage>
          <UiInput
            ref={connectionNameRef}
            label="Connection name"
            value={connectionName}
            error={nameError}
            onChange={(event) => { setConnectionName(event.target.value); setNameError(undefined); }}
            required
          />

          <UiDetails className="modal-disclosure">
            <summary>
              Advanced configuration
              {!usesDefaultConfiguration && <span className="settings-description ml-2">Customized</span>}
            </summary>
            <div className="settings-stack pt-2">
              {variant === "iam" && (
                <div>
                  <SettingsSection title="IAM groups" presentation="compact">
                    <div className="settings-fields">
                      {groups.length === 0 && <span className="settings-description">No groups available.</span>}
                      {groups.map((group) => (
                        <UiCheckboxField
                          key={group.name}
                          className="settings-choice min-w-0"
                          checked={selectedGroups.includes(group.name)}
                          onChange={(event) => setSelectedGroups((current) => event.target.checked
                            ? [...current, group.name]
                            : current.filter((name) => name !== group.name))}
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">{group.name}</span>
                        </UiCheckboxField>
                      ))}
                    </div>
                  </SettingsSection>
                  <SettingsSection title="Managed policies" presentation="compact">
                    <div className="settings-fields">
                      {availablePolicies.map((policy) => (
                        <UiCheckboxField
                          key={policy.arn}
                          className="settings-choice min-w-0"
                          checked={selectedPolicies.includes(policy.arn)}
                          onChange={(event) => setSelectedPolicies((current) => event.target.checked
                            ? [...current, policy.arn]
                            : current.filter((arn) => arn !== policy.arn))}
                          labelProps={{ title: policy.arn }}
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">{policy.name}</span>
                        </UiCheckboxField>
                      ))}
                    </div>
                  </SettingsSection>
                  <SettingsSection title="Inline policies" presentation="compact">
                    <div className="settings-fields">
                      {inlinePolicies.length > 0 && (
                        <ul className="grid gap-2">
                          {inlinePolicies.map((policy) => (
                            <li key={policy.name} className="flex min-w-0 items-start justify-between gap-2">
                              <span className="settings-label min-w-0 [overflow-wrap:anywhere]">{policy.name}</span>
                              <SettingsButton variant="ghost" aria-label={`Remove inline policy ${policy.name}`}
                                onClick={() => { setInlinePolicies((current) => current.filter((item) => item.name !== policy.name)); setInlineNameError(undefined); }}>
                                Remove
                              </SettingsButton>
                            </li>
                          ))}
                        </ul>
                      )}
                      <UiInput
                        label="Inline policy name"
                        value={inlineName}
                        error={inlineNameError}
                        onChange={(event) => { setInlineName(event.target.value); setInlineNameError(undefined); }}
                      />
                      <UiTextarea
                        label="Inline policy document"
                        value={inlineDocument}
                        error={inlineDocumentError}
                        hint="Provide a JSON object, then add it to the policies for this access."
                        onChange={(event) => { setInlineDocument(event.target.value); setInlineDocumentError(undefined); }}
                        rows={6}
                        spellCheck={false}
                        className="font-mono"
                      />
                      <div className="flex justify-end">
                        <SettingsButton variant="secondary" onClick={addInlinePolicy}>Add inline policy</SettingsButton>
                      </div>
                    </div>
                  </SettingsSection>
                </div>
              )}
              <S3ConnectionAccessFields
                accessBrowser={accessBrowser}
                accessManager={accessManager}
                onAccessBrowserChange={(value) => { setAccessBrowser(value); setAccessError(undefined); }}
                onAccessManagerChange={(value) => { setAccessManager(value); setAccessError(undefined); }}
                hint="Browser is selected by default. At least one workspace must remain enabled."
                error={accessError}
                className="settings-fields"
              />
            </div>
          </UiDetails>
          <ModalActions>
            <SettingsButton variant="secondary" onClick={closeGuard.requestClose}>Cancel</SettingsButton>
            <SettingsButton type="submit">{busy ? "Creating…" : "Create my private access"}</SettingsButton>
          </ModalActions>
        </fieldset>
      </form>
      {closeGuard.confirmationDialog}
    </SettingsDialog>
  );
}
