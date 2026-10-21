/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { iamNameFormatError } from "../../utils/resourceNames";
import { ListActions, ListBadge, ListActionLink, ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { IAMGroup, attachGroupPolicy, createIamGroup, deleteIamGroup, listIamGroups } from "../../api/managerIamGroups";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { dataTableDefaultActionProps, type DataTableColumn } from "../../components/list/DataTableShell";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { workflowPageHostClass } from "../../components/WorkflowPage";

import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyDraftEditor from "./InlinePolicyDraftEditor";
import ManagedPolicySelectionPanel from "./ManagedPolicySelectionPanel";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import { useInlinePolicyDraftEditor } from "./useInlinePolicyDraftEditor";
import { useManagerIamCollection } from "./useManagerIamCollection";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import { useManagerI18n } from "./managerI18n";

export default function ManagerGroupsPage() {
  const { text } = useManagerI18n();
  const deleteConfirmation = useConfirmActionDialog();
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode, namingValidationProfile } = useExecutionContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";
  const [groupFilter, setGroupFilter] = useState("");
  const {
    error,
    items: groups,
    load,
    loadRelated,
    loading,
    setError,
    setItems: setGroups,
    setLoading,
  } = useManagerIamCollection(listIamGroups);
  const {
    inlineDraftNameError,
    validateInlineDrafts,
    inlineDraftMode,
    inlineDraftName,
    inlineDrafts,
    inlinePolicyText,
    selectedInlineDraftName,
    showInlinePolicyOptions,
    setInlineDraftName,
    setInlinePolicyText,
    setShowInlinePolicyOptions,
    handleAddInlineDraft,
    handleClearInlineDrafts,
    handleCreateInlineDraft,
    handleRemoveInlineDraft,
    handleSelectInlineDraft,
    resetInlinePolicyDraftEditor,
  } = useInlinePolicyDraftEditor(setError, "group", namingValidationProfile);
  const [advancedName, setAdvancedName] = useState("");
  const [advancedValidationAttempted, setAdvancedValidationAttempted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({
      advancedName: "",
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    })
  );

  const loadPolicies = useCallback(
    (contextId: S3ExecutionContextSelector) =>
      loadRelated(contextId, listIamPolicies, setPolicies),
    [loadRelated],
  );

  useEffect(() => {
    if (needsContextSelection) {
      setGroups([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(contextIdForApi);
    loadPolicies(contextIdForApi);
    resetInlinePolicyDraftEditor();
  }, [contextIdForApi, needsContextSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor, setGroups, setLoading]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  const advancedCurrentSignature = useMemo(
    () =>
      stableSignature({
        advancedName,
        selectedPolicies,
        inlineDrafts,
        inlineDraftName,
        inlinePolicyText,
      }),
    [advancedName, inlineDraftName, inlineDrafts, inlinePolicyText, selectedPolicies]
  );

  const nameFormatError = iamNameFormatError(advancedName.trim(), "group");

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsContextSelection || busy !== null) return;
    setAdvancedValidationAttempted(true);
    if (!advancedName.trim() || nameFormatError || !validateInlineDrafts()) {
      focusFirstInvalidField(e.currentTarget as HTMLFormElement);
      return;
    }
    setBusy(advancedName);
    setError(null);
    setActionMessage(null);
    try {
      const groupName = advancedName.trim();
      await createIamGroup(contextIdForApi, groupName, inlineDrafts);
      if (selectedPolicies.length > 0) {
        for (const arn of selectedPolicies) {
          const policy = policies.find((p) => p.arn === arn);
          if (policy) {
            await attachGroupPolicy(contextIdForApi, groupName, policy);
          }
        }
      }
      setAdvancedName("");
      setSelectedPolicies([]);
      setPolicySearch("");
      setShowPolicyOptions(false);
      resetInlinePolicyDraftEditor();
      setShowCreateForm(false);
      setActionMessage(text("Group created"));
      await load(contextIdForApi);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setBusy(null);
    }
  };

  const deleteGroup = async (name: string) => {
    if (needsContextSelection) return;
    setBusy(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamGroup(contextIdForApi, name);
      setActionMessage(text("Group deleted"));
      await load(contextIdForApi);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = (name: string) => {
    if (needsContextSelection) return;
    deleteConfirmation.requestConfirmation({
      title: text("Delete IAM group?"),
      description: text("Permanently remove this IAM group from the selected context."),
      confirmLabel: text("Delete group"),
      details: [{ label: text("IAM group"), value: name }],
      impacts: ["Members will lose permissions inherited only through this group."],
      onConfirm: () => deleteGroup(name),
    });
  };

  const openCreateForm = () => {
    setError(null);
    setAdvancedValidationAttempted(false);
    setAdvancedName("");
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
    setShowCreateForm(true);
    setAdvancedInitialSignature(
      stableSignature({
        advancedName: "",
        selectedPolicies: [],
        inlineDrafts: [],
        inlineDraftName: "",
        inlinePolicyText: "",
      })
    );
  };

  const closeCreateForm = () => {
    setShowCreateForm(false);
    setAdvancedName("");
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
  };


  const filteredGroups = groups.filter((group) => {
    const needle = groupFilter.trim().toLowerCase();
    if (!needle) return true;
    return group.name.toLowerCase().includes(needle) || (group.arn ?? "").toLowerCase().includes(needle);
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredGroups.length,
  });
  const groupTableColumns: Array<DataTableColumn<IAMGroup>> = [
    { id: "name", label: text("Name"), primary: true, mobileRole: "primary", render: (group) => group.name },
    { id: "arn", label: text("ARN"), render: (group) => group.arn ?? "-" },
    {
      id: "policies",
      label: text("Policies"),
      cellClassName: "ui-table-wide",
      render: (group) =>
        group.policies && group.policies.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {group.policies.map((policy) => (
              <ListBadge
                key={policy}
                tone="neutral"
                title={policy}
              >
                {policy.split("/").pop()}
              </ListBadge>
            ))}
          </div>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
        ),
    },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      actionWidth: "compact",
      render: (group) => (
        <ListActions>
          <ListActionLink
            to={`/manager/groups/${encodeURIComponent(group.name)}`}
            {...dataTableDefaultActionProps}
          >
            {text("Edit")}
          </ListActionLink>
          <ListActionButton
            onClick={() => handleDelete(group.name)}
             variant="danger"
            disabled={busy === group.name}
          >
              {text(busy === group.name ? "Deleting..." : "Delete")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateForm)}>
      <PageHeader actionPresentation="listing"
        title={text("IAM Groups")}
        description={text("Manage groups using the account root keys.")}
        breadcrumbs={managerPageBreadcrumbs(text, "groups")}
        actions={
          !needsContextSelection && !isS3User
            ? [
                {
                  label: text("Create group"),
                  onClick: openCreateForm,
                },
              ]
            : []
        }
      />

      {!showCreateForm && error && <PageBanner tone="error">{text(error)}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {needsContextSelection ? (
        <PageEmptyState
          title={text("Select a context before managing IAM groups")}
          description={text("Groups are scoped to an execution context. Choose a context to list membership containers and attach shared policies.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title={text("IAM groups are unavailable for managed S3 user contexts")}
          description={text("Switch to an RGW account or S3 connection context to manage account-level IAM groups.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title={text("Groups")}
            countLabel={text(filteredGroups.length === 1 ? "{count} result" : "{count} results", { count: filteredGroups.length })}
            search={
              <ManagerToolbarSearch
                value={groupFilter}
                onChange={setGroupFilter}
                placeholder={text("Search by name or ARN")}
              />
            }
        >
          <DataTableShell
            columns={groupTableColumns}
            rows={filteredGroups}
            rowKey={(group) => group.name}
            status={filteredTableStatus}
            loadingMessage={text("Loading groups...")}
            errorMessage={text("Unable to load groups.")}
            emptyMessage={text("No groups.")}
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showCreateForm && (
        <SettingsWorkflowForm
          title={text("Create IAM group")}
          description={text("Create a group and assign its managed and inline policies.")}
          breadcrumbs={managerPageBreadcrumbs(text, "groups", { label: text("Create") })}
          backLabel={text("Back to groups")}
          onClose={closeCreateForm}
          contentVariant="plain"
          dirty={advancedCurrentSignature !== advancedInitialSignature}
          error={error} onSubmit={handleAdvancedCreate}
          busy={busy !== null} disabled={needsContextSelection || namingValidationProfile === null}
          submitLabel={text("Create group")} busyLabel={text("Creating...")}
        >
          <SettingsSection title={text("Identity")} presentation="compact">
            <div className="settings-fields">
              <UiInput label={text("Group name")} required value={advancedName} onChange={(event) => setAdvancedName(event.target.value)}
                placeholder={text("Group name")} error={nameFormatError ? text(nameFormatError!) : advancedValidationAttempted && !advancedName.trim() ? text("Group name is required.") : undefined} />
            </div>
          </SettingsSection>
          <ManagedPolicySelectionPanel
            title={text("Attach policies")}
            description={text("Select managed policies to link immediately.")}
            emptyMessage={text("No policies available. Create them first.")}
            footer="Policies can also be attached later from the group page."
            policies={policies}
            selectedPolicyArns={selectedPolicies}
            search={policySearch}
            expanded={showPolicyOptions}
            onSearchChange={setPolicySearch}
            onExpandedChange={setShowPolicyOptions}
            onSelectionChange={setSelectedPolicies}
          />
          <InlinePolicyDraftEditor
            drafts={inlineDrafts}
            selectedDraftName={selectedInlineDraftName}
            draftName={inlineDraftName}
            nameError={inlineDraftNameError}
            draftText={inlinePolicyText}
            entityLabel="group"
            mode={inlineDraftMode}
            expanded={showInlinePolicyOptions}
            onCreateDraft={handleCreateInlineDraft}
            onSelectDraft={handleSelectInlineDraft}
            onDraftNameChange={(value) => {
              setInlineDraftName(value);
              setError(null);
            }}
            onDraftTextChange={(value) => {
              setInlinePolicyText(value);
              setError(null);
            }}
            onSaveDraft={handleAddInlineDraft}
            onRemoveDraft={handleRemoveInlineDraft}
            onClearDrafts={handleClearInlineDrafts}
            onInsertTemplate={() => setInlinePolicyText(DEFAULT_INLINE_POLICY_TEXT)}
            onToggleExpanded={() => setShowInlinePolicyOptions((prev) => !prev)}
          />
        </SettingsWorkflowForm>
      )}
      {deleteConfirmation.confirmationDialog}
    </div>
  );
}
