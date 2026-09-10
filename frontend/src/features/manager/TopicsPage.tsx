/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInput from "../../components/ui/UiInput";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiTextarea from "../../components/ui/UiTextarea";
import ModalActions from "../../components/ModalActions";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import {
  createTopic,
  deleteTopic,
  getTopicConfiguration,
  getTopicPolicy,
  listTopics,
  updateTopicConfiguration,
  updateTopicPolicy,
  Topic,
} from "../../api/topics";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import Modal from "../../components/Modal";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { createUiDraftId } from "../../utils/uiDraftId";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

const defaultPolicyTemplate = `{
  "Version": "2012-10-17",
  "Statement": []
}`;

type AttributeDraft = {
  uiId: string;
  key: string;
  value: string;
};

const PRIMARY_ATTRIBUTE_KEYS = new Set(["push-endpoint", "verify-ssl"]);

const formatAttributeValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseAttributeValue = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: "" };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { value: JSON.parse(trimmed) };
    } catch {
      return { value: null, error: "JSON values must be valid objects or arrays." };
    }
  }
  return { value: raw };
};

const buildAttributeDrafts = (configuration: Record<string, unknown> | null | undefined): AttributeDraft[] => {
  return Object.entries(configuration ?? {})
    .filter(([key]) => !PRIMARY_ATTRIBUTE_KEYS.has(key))
    .map(([key, value]) => ({ uiId: createUiDraftId("topic-attribute"), key, value: formatAttributeValue(value) }));
};

const readPushEndpointValue = (configuration: Record<string, unknown> | null | undefined): string => {
  const value = configuration?.["push-endpoint"];
  return typeof value === "string" ? value : "";
};

const readVerifySslValue = (configuration: Record<string, unknown> | null | undefined): boolean => {
  const value = configuration?.["verify-ssl"];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
  }
  return true;
};

const buildAttributesSignature = (
  pushEndpointValue: string,
  verifySslValue: boolean,
  attributeItems: AttributeDraft[]
) =>
  stableSignature({
    pushEndpointValue,
    verifySslValue,
    attributeItems: attributeItems.map(({ key, value }) => ({ key, value })),
  });

function extractError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
}

export default function TopicsPage() {
  const deleteConfirmation = useConfirmActionDialog();
  const sslHintId = useId();
  const policyExampleId = useId();
  const {
    accounts,
    selectedS3AccountId,
    accountIdForApi,
    requiresS3AccountSelection,
    accessMode,
  } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const selectedS3Account = useMemo(() => {
    const accountKey = accountIdForApi ?? selectedS3AccountId;
    if (accountKey == null) return undefined;
    return accounts.find((account) => String(account.id) === String(accountKey));
  }, [accounts, accountIdForApi, selectedS3AccountId]);
  const endpointCaps = selectedS3Account?.storage_endpoint_capabilities ?? null;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [createInitialSignature, setCreateInitialSignature] = useState(() => stableSignature({ newTopicName: "" }));
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNameError, setCreateNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyTopicArn, setPolicyTopicArn] = useState<string | null>(null);
  const [policyTopicName, setPolicyTopicName] = useState<string | null>(null);
  const [policyText, setPolicyText] = useState(defaultPolicyTemplate);
  const [policyInitialSignature, setPolicyInitialSignature] = useState(() =>
    stableSignature({ policyText: defaultPolicyTemplate })
  );
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyValidationError, setPolicyValidationError] = useState<string | null>(null);
  const [policyStatus, setPolicyStatus] = useState<string | null>(null);
  const [showPolicyExample, setShowPolicyExample] = useState(false);
  const [attributesModalOpen, setAttributesModalOpen] = useState(false);
  const [attributesTopicArn, setAttributesTopicArn] = useState<string | null>(null);
  const [attributesTopicName, setAttributesTopicName] = useState<string | null>(null);
  const [pushEndpointValue, setPushEndpointValue] = useState("");
  const [verifySslValue, setVerifySslValue] = useState(true);
  const [attributeItems, setAttributeItems] = useState<AttributeDraft[]>([]);
  const [attributesInitialSignature, setAttributesInitialSignature] = useState(() =>
    buildAttributesSignature("", true, [])
  );
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesSaving, setAttributesSaving] = useState(false);
  const [attributesError, setAttributesError] = useState<string | null>(null);
  const [attributesStatus, setAttributesStatus] = useState<string | null>(null);

  const applyAttributesConfiguration = (configuration: Record<string, unknown> | null | undefined) => {
    const config = configuration ?? {};
    const pushEndpoint = readPushEndpointValue(config);
    const verifySsl = readVerifySslValue(config);

    setPushEndpointValue(pushEndpoint);
    setVerifySslValue(verifySsl);
    setAttributeItems(buildAttributeDrafts(config));
  };

  const fetchTopics = useCallback(async (accountId: number | string | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTopics(accountId);
      setTopics(data);
    } catch (err) {
      setTopics([]);
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (needsS3AccountSelection) {
      setTopics([]);
      setLoading(false);
      return;
    }
    fetchTopics(accountIdForApi ?? null);
  }, [accountIdForApi, needsS3AccountSelection, accessMode, fetchTopics]);

  const openCreateModal = () => {
    setCreateNameError(null);
    setNewTopicName("");
    setCreateInitialSignature(stableSignature({ newTopicName: "" }));
    setShowCreateModal(true);
    setCreateError(null);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewTopicName("");
    setCreateError(null);
    setCreateInitialSignature(stableSignature({ newTopicName: "" }));
  };

  const handleCreateTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (needsS3AccountSelection) return;
    const trimmedName = newTopicName.trim();
    if (!trimmedName) {
      setCreateNameError("Topic name is required.");
      return;
    }
    setCreateNameError(null);
    setCreateError(null);
    setCreating(true);
    try {
      await createTopic(accountIdForApi ?? null, {
        name: trimmedName,
      });
      setShowCreateModal(false);
      setNewTopicName("");
      setActionMessage(`Topic '${trimmedName}' created.`);
      await fetchTopics(accountIdForApi ?? null);
    } catch (err) {
      setCreateError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const deleteSelectedTopic = async (topicArn: string, name: string) => {
    if (needsS3AccountSelection) return;
    try {
      await deleteTopic(accountIdForApi ?? null, topicArn);
      setActionMessage(`Topic '${name}' deleted.`);
      await fetchTopics(accountIdForApi ?? null);
    } catch (err) {
      setError(extractError(err));
    }
  };

  const handleDeleteTopic = (topicArn: string, name: string) => {
    if (needsS3AccountSelection) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete notification topic?",
      description: "Permanently remove this SNS topic from the selected account.",
      confirmLabel: "Delete topic",
      details: [
        { label: "Topic", value: name },
        { label: "ARN", value: topicArn, mono: true },
      ],
      impacts: ["Bucket notifications targeting this topic will no longer be delivered."],
      onConfirm: () => deleteSelectedTopic(topicArn, name),
    });
  };

  const openPolicyModal = async (topicArn: string, name: string) => {
    if (needsS3AccountSelection) return;
    setPolicyModalOpen(true);
    setPolicyTopicArn(topicArn);
    setPolicyTopicName(name);
    setPolicyText(defaultPolicyTemplate);
    setPolicyValidationError(null);
    setPolicyError(null);
    setPolicyStatus(null);
    setShowPolicyExample(false);
    setPolicyLoading(true);
    try {
      const data = await getTopicPolicy(accountIdForApi, topicArn);
      const policy = data.policy ?? {};
      const nextPolicyText = Object.keys(policy).length > 0 ? JSON.stringify(policy, null, 2) : defaultPolicyTemplate;
      setPolicyText(nextPolicyText);
      setPolicyInitialSignature(stableSignature({ policyText: nextPolicyText }));
    } catch (err) {
      setPolicyError(extractError(err));
    } finally {
      setPolicyLoading(false);
    }
  };

  const savePolicy = async () => {
    if (needsS3AccountSelection || !policyTopicArn) return;
    let parsed: Record<string, unknown>;
    setPolicyError(null);
    setPolicyStatus(null);
    try {
      parsed = policyText.trim() ? JSON.parse(policyText) : {};
    } catch {
      setPolicyValidationError("Policy must be valid JSON.");
      return;
    }
    setPolicyValidationError(null);
    setPolicySaving(true);
    try {
      await updateTopicPolicy(accountIdForApi, policyTopicArn, parsed);
      setPolicyStatus("Policy updated.");
      setPolicyInitialSignature(stableSignature({ policyText }));
    } catch (err) {
      setPolicyError(extractError(err));
    } finally {
      setPolicySaving(false);
    }
  };

  const closePolicyModal = () => {
    setPolicyModalOpen(false);
    setPolicyTopicArn(null);
    setPolicyTopicName(null);
    setPolicyStatus(null);
    setPolicyError(null);
    setShowPolicyExample(false);
    setPolicyInitialSignature(stableSignature({ policyText: defaultPolicyTemplate }));
  };

  const openAttributesModal = (topic: Topic) => {
    if (needsS3AccountSelection) return;
    setAttributesModalOpen(true);
    setAttributesTopicArn(topic.arn);
    setAttributesTopicName(topic.name);
    setAttributesError(null);
    setAttributesStatus(null);
    applyAttributesConfiguration(topic.configuration ?? {});
    setAttributesInitialSignature(
      buildAttributesSignature(
        readPushEndpointValue(topic.configuration),
        readVerifySslValue(topic.configuration),
        buildAttributeDrafts(topic.configuration ?? {})
      )
    );
    setAttributesLoading(true);
    (async () => {
      try {
        const data = await getTopicConfiguration(accountIdForApi, topic.arn);
        const configuration = data.configuration ?? {};
        applyAttributesConfiguration(configuration);
        setAttributesInitialSignature(
          buildAttributesSignature(
            readPushEndpointValue(configuration),
            readVerifySslValue(configuration),
            buildAttributeDrafts(configuration)
          )
        );
      } catch (err) {
        setAttributesError(extractError(err));
      } finally {
        setAttributesLoading(false);
      }
    })();
  };

  const saveAttributes = async () => {
    if (needsS3AccountSelection || !attributesTopicArn) return;
    setAttributesError(null);
    setAttributesStatus(null);
    const configuration: Record<string, unknown> = {};
    const trimmedEndpoint = pushEndpointValue.trim();
    if (trimmedEndpoint) {
      configuration["push-endpoint"] = trimmedEndpoint;
    }
    if (!verifySslValue) {
      configuration["verify-ssl"] = false;
    }

    const seenKeys = new Set<string>();
    for (const item of attributeItems) {
      const key = item.key.trim();
      const rawValue = item.value ?? "";
      const hasValue = rawValue.trim().length > 0;
      if (!key) {
        if (hasValue) {
          setAttributesError("Attribute name is required when a value is provided.");
          return;
        }
        continue;
      }
      if (PRIMARY_ATTRIBUTE_KEYS.has(key)) {
        setAttributesError("Use the dedicated fields for push-endpoint and verify-ssl.");
        return;
      }
      if (seenKeys.has(key)) {
        setAttributesError(`Duplicate attribute key: ${key}.`);
        return;
      }
      const parsed = parseAttributeValue(rawValue);
      if (parsed.error) {
        setAttributesError(`${parsed.error} (${key}).`);
        return;
      }
      configuration[key] = parsed.value;
      seenKeys.add(key);
    }

    setAttributesSaving(true);
    try {
      const updated = await updateTopicConfiguration(accountIdForApi, attributesTopicArn, configuration);
      const newConfig = updated.configuration ?? {};
      applyAttributesConfiguration(newConfig);
      setAttributesInitialSignature(
        buildAttributesSignature(
          readPushEndpointValue(newConfig),
          readVerifySslValue(newConfig),
          buildAttributeDrafts(newConfig)
        )
      );
      setAttributesStatus("Attributes updated.");
      setTopics((prev) =>
        prev.map((topic) =>
          topic.arn === attributesTopicArn ? { ...topic, configuration: newConfig } : topic
        )
      );
    } catch (err) {
      setAttributesError(extractError(err));
    } finally {
      setAttributesSaving(false);
    }
  };

  const closeAttributesModal = () => {
    setAttributesModalOpen(false);
    setAttributesTopicArn(null);
    setAttributesTopicName(null);
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributesLoading(false);
    setAttributesSaving(false);
    setPushEndpointValue("");
    setVerifySslValue(true);
    setAttributeItems([]);
    setAttributesInitialSignature(buildAttributesSignature("", true, []));
  };

  const handleAttributeKeyChange = (uiId: string, value: string) => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) =>
      prev.map((item) => (item.uiId === uiId ? { ...item, key: value } : item))
    );
  };

  const handleAttributeValueChange = (uiId: string, value: string) => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) =>
      prev.map((item) => (item.uiId === uiId ? { ...item, value } : item))
    );
  };

  const handleAddAttribute = () => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) => [...prev, { uiId: createUiDraftId("topic-attribute"), key: "", value: "" }]);
  };

  const handleRemoveAttribute = (uiId: string) => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) => prev.filter((item) => item.uiId !== uiId));
  };

  const policyExample = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "AllowBucketNotifications",
      Effect: "Allow",
      Principal: "*",
      Action: "sns:Publish",
      Resource: policyTopicArn ?? "arn:aws:sns:default:::topic",
      Condition: { ArnLike: { "aws:SourceArn": "arn:aws:s3:::example-bucket" } },
    }],
  }, null, 2);
  const attributesBusy = attributesLoading || attributesSaving;
  const policyBusy = policyLoading || policySaving;

  const filteredTopics = useMemo(() => {
    const needle = topicFilter.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter(
      (topic) =>
        topic.name.toLowerCase().includes(needle) ||
        topic.arn.toLowerCase().includes(needle)
    );
  }, [topicFilter, topics]);
  const createCurrentSignature = useMemo(() => stableSignature({ newTopicName }), [newTopicName]);
  const policyCurrentSignature = useMemo(() => stableSignature({ policyText }), [policyText]);
  const attributesCurrentSignature = useMemo(
    () => buildAttributesSignature(pushEndpointValue, verifySslValue, attributeItems),
    [attributeItems, pushEndpointValue, verifySslValue]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateModal && createCurrentSignature !== createInitialSignature,
    onClose: closeCreateModal,
    disabled: creating,
  });
  const policyCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: policyModalOpen && !policyLoading && policyCurrentSignature !== policyInitialSignature,
    onClose: closePolicyModal,
    disabled: policySaving,
  });
  const attributesCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: attributesModalOpen && !attributesLoading && attributesCurrentSignature !== attributesInitialSignature,
    onClose: closeAttributesModal,
    disabled: attributesSaving,
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredTopics.length,
  });
  const topicColumns: Array<DataTableColumn<Topic>> = [
    {
      id: "topic",
      label: "Topic",
      primary: true,
      cellClassName: "ui-table-wide",
      render: (topic) => (
        <div className="flex min-w-0 flex-col">
          <span className="ui-body font-semibold text-slate-900 dark:text-slate-100">{topic.name}</span>
          <span className="break-all font-mono ui-caption text-slate-500 dark:text-slate-400">{topic.arn}</span>
        </div>
      ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (topic) => (
        <ListActions>
          <ListActionButton
            type="button"
            onClick={() => openAttributesModal(topic)}
          >
            Attributes
          </ListActionButton>
          <ListActionButton
            type="button"
            onClick={() => openPolicyModal(topic.arn, topic.name)}
          >
            Policy
          </ListActionButton>
          <ListActionButton
            type="button"
             variant="danger"
            onClick={() => handleDeleteTopic(topic.arn, topic.name)}
          >
            Delete
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(attributesModalOpen || policyModalOpen)}>
      <PageHeader actionPresentation="listing"
        title="SNS Topics"
        description="List, create, and secure account-owned SNS topics."
        breadcrumbs={managerPageBreadcrumbs("topics")}
        actions={
          !needsS3AccountSelection && snsFeatureEnabled
            ? [
                {
                  label: "Create topic",
                  onClick: openCreateModal,
                },
              ]
            : []
        }
      />

      {actionMessage && (
        <PageBanner tone="success" className="flex items-center justify-between">
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="ui-caption font-semibold text-emerald-900 underline dark:text-emerald-100"
          >
            Dismiss
          </button>
        </PageBanner>
      )}

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing SNS topics"
          description="SNS topics are created within an execution context. Choose an account to list topics and update notification settings."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !snsFeatureEnabled ? (
        <PageEmptyState
          title="SNS topics are disabled for this endpoint"
          description="Enable the SNS capability on the selected storage endpoint before creating or managing topic-based bucket notifications."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title="Topics"
            countLabel={`${filteredTopics.length} result(s)`}
            search={
              <UiInput aria-label="Search" size="compact"
                type="search"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder="Search by topic or ARN"
              />
            }
        >
          <DataTableShell
            columns={topicColumns}
            rows={filteredTopics}
            rowKey={(topic) => topic.arn}
            status={filteredTableStatus}
            loadingMessage="Loading topics..."
            errorMessage="Unable to load topics."
            emptyMessage="No topics."
            tableClassName="ui-data-table"
            responsiveCards
          />
        </ListPageSection>
      )}

      {showCreateModal && (
        <Modal title="Create SNS topic" onClose={createCloseGuard.requestClose} closeDisabled={creating} maxWidthClass="max-w-lg">
          <form className="space-y-4" onSubmit={handleCreateTopic}>
            <UiInput
              label="Topic name"
              value={newTopicName}
              onChange={(event) => {
                setNewTopicName(event.target.value);
                setCreateNameError(null);
              }}
              error={createNameError}
              placeholder="events-topic"
              disabled={creating}
            />
            {createError && <UiInlineMessage tone="error">{createError}</UiInlineMessage>}
            <ModalActions>
              <UiButton variant="secondary" onClick={createCloseGuard.requestClose} disabled={creating}>
                Cancel
              </UiButton>
              <UiButton type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create topic"}
              </UiButton>
            </ModalActions>
          </form>
          {createCloseGuard.confirmationDialog}
        </Modal>
      )}

      {attributesModalOpen && (
        <WorkflowPage
          title={`Topic attributes · ${attributesTopicName ?? ""}`}
          description="Configure notification delivery and provider-specific SNS attributes."
          breadcrumbs={managerPageBreadcrumbs("topics", { label: "Attributes" })}
          backLabel="Back to topics"
          onBack={attributesCloseGuard.requestClose}
          width="standard"
          contentClassName="settings-compact settings-form"
        >
          <div className="settings-stack">
            {attributesError && <UiInlineMessage tone="error">{attributesError}</UiInlineMessage>}
            {attributesStatus && <UiInlineMessage tone="success">{attributesStatus}</UiInlineMessage>}
            <SettingsSection title="Notification delivery" presentation="compact">
              <div className="settings-fields">
                <UiInput
                  label="Push endpoint URL"
                  value={pushEndpointValue}
                  onChange={(event) => {
                    setAttributesStatus(null);
                    setAttributesError(null);
                    setPushEndpointValue(event.target.value);
                  }}
                  placeholder="https://example.com/webhook"
                  hint="Provide the HTTPS endpoint that should receive SNS push notifications."
                  disabled={attributesBusy}
                />
                <div>
                  <UiCheckboxField
                    className="settings-choice"
                    checked={verifySslValue}
                    aria-describedby={sslHintId}
                    onChange={(event) => {
                      setAttributesStatus(null);
                      setAttributesError(null);
                      setVerifySslValue(event.target.checked);
                    }}
                    disabled={attributesBusy}
                  >
                    Verify SSL certificates
                  </UiCheckboxField>
                  <p id={sslHintId} className="settings-description">
                    Disable verification only when testing against endpoints that use self-signed certificates.
                  </p>
                </div>
              </div>
            </SettingsSection>
            <SettingsSection
              title="Additional attributes"
              description="Paste JSON for object/array values; remove a row to clear an attribute."
              presentation="compact"
            >
              <div className="settings-stack">
                <div>
                  <SettingsButton variant="secondary" onClick={handleAddAttribute} disabled={attributesBusy}>
                    Add attribute
                  </SettingsButton>
                </div>
                {attributeItems.length === 0 ? (
                  <p className="settings-description">No additional attributes defined.</p>
                ) : (
                  attributeItems.map((item, index) => (
                    <div key={item.uiId} className="settings-fields items-end md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <UiInput
                        label="Attribute name"
                        aria-label={`Attribute name ${index + 1}`}
                        value={item.key}
                        onChange={(event) => handleAttributeKeyChange(item.uiId, event.target.value)}
                        placeholder="attribute-key"
                        disabled={attributesBusy}
                      />
                      <UiInput
                        label="Value"
                        aria-label={`Attribute value ${index + 1}`}
                        value={item.value}
                        onChange={(event) => handleAttributeValueChange(item.uiId, event.target.value)}
                        className="font-mono"
                        placeholder='value or JSON ({"key":"value"})'
                        disabled={attributesBusy}
                      />
                      <SettingsButton
                        variant="secondary"
                        aria-label={`Remove attribute ${index + 1}`}
                        onClick={() => handleRemoveAttribute(item.uiId)}
                        disabled={attributesBusy}
                      >
                        Remove
                      </SettingsButton>
                    </div>
                  ))
                )}
              </div>
            </SettingsSection>
            <WorkflowActions>
              <SettingsButton variant="secondary" onClick={attributesCloseGuard.requestClose} disabled={attributesSaving}>
                Close
              </SettingsButton>
              <SettingsButton onClick={saveAttributes} disabled={attributesBusy}>
                {attributesSaving ? "Saving..." : "Save attributes"}
              </SettingsButton>
            </WorkflowActions>
          </div>
          {attributesCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {policyModalOpen && (
        <WorkflowPage
          title={`Topic policy · ${policyTopicName ?? ""}`}
          description="Edit the SNS policy that controls access to this topic."
          breadcrumbs={managerPageBreadcrumbs("topics", { label: "Policy" })}
          backLabel="Back to topics"
          onBack={policyCloseGuard.requestClose}
          width="standard"
          contentClassName="settings-compact settings-form"
        >
          <div className="settings-stack">
            {policyError && <UiInlineMessage tone="error">{policyError}</UiInlineMessage>}
            {policyStatus && <UiInlineMessage tone="success">{policyStatus}</UiInlineMessage>}
            <UiTextarea
              label="Policy JSON"
              value={policyText}
              onChange={(event) => {
                setPolicyText(event.target.value);
                setPolicyStatus(null);
                setPolicyValidationError(null);
              }}
              error={policyValidationError}
              className="font-mono"
              rows={16}
              placeholder={defaultPolicyTemplate}
              spellCheck={false}
              disabled={policyBusy}
            />
            <SettingsSection title="Policy example" presentation="compact">
              <div className="settings-stack">
                <div className="flex flex-wrap items-center gap-2">
                  <SettingsButton
                    variant="secondary"
                    aria-expanded={showPolicyExample}
                    aria-controls={policyExampleId}
                    onClick={() => setShowPolicyExample((previous) => !previous)}
                  >
                    {showPolicyExample ? "Hide example" : "Show example"}
                  </SettingsButton>
                  <SettingsButton
                    variant="secondary"
                    disabled={policyBusy}
                    onClick={() => {
                      setPolicyText(policyExample);
                      setShowPolicyExample(true);
                      setPolicyStatus(null);
                      setPolicyValidationError(null);
                    }}
                  >
                    Use example
                  </SettingsButton>
                </div>
                <pre
                  id={policyExampleId}
                  hidden={!showPolicyExample}
                  className="min-w-0 whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border-soft)] bg-[var(--ui-surface-muted)] p-3 font-mono ui-caption text-[var(--ui-text)]"
                >
                  {policyExample}
                </pre>
              </div>
            </SettingsSection>
            <WorkflowActions>
              <SettingsButton variant="secondary" onClick={policyCloseGuard.requestClose} disabled={policySaving}>
                Close
              </SettingsButton>
              <SettingsButton onClick={savePolicy} disabled={policyBusy}>
                {policySaving ? "Saving..." : "Save policy"}
              </SettingsButton>
            </WorkflowActions>
          </div>
          {policyCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
      {deleteConfirmation.confirmationDialog}
    </div>
  );
}
