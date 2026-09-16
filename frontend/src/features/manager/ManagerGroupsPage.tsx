/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListBadge, ListActionLink, ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { S3AccountSelector } from "../../api/accountParams";
import { IAMGroup, attachGroupPolicy, createIamGroup, deleteIamGroup, listIamGroups } from "../../api/managerIamGroups";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
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

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function ManagerGroupsPage() {
  const deleteConfirmation = useConfirmActionDialog();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
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
  } = useInlinePolicyDraftEditor(setError);
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
    (accountId: S3AccountSelector) =>
      loadRelated(accountId, listIamPolicies, setPolicies),
    [loadRelated],
  );

  useEffect(() => {
    if (needsS3AccountSelection) {
      setGroups([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
    loadPolicies(accountIdForApi);
    resetInlinePolicyDraftEditor();
  }, [accountIdForApi, needsS3AccountSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor, setGroups, setLoading]);

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

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || busy !== null) return;
    setAdvancedValidationAttempted(true);
    if (!advancedName.trim()) {
      focusFirstInvalidField(e.currentTarget as HTMLFormElement);
      return;
    }
    setBusy(advancedName);
    setError(null);
    setActionMessage(null);
    try {
      const groupName = advancedName.trim();
      await createIamGroup(accountIdForApi, groupName, inlineDrafts);
      if (selectedPolicies.length > 0) {
        for (const arn of selectedPolicies) {
          const policy = policies.find((p) => p.arn === arn);
          if (policy) {
            await attachGroupPolicy(accountIdForApi, groupName, policy);
          }
        }
      }
      setAdvancedName("");
      setSelectedPolicies([]);
      setPolicySearch("");
      setShowPolicyOptions(false);
      resetInlinePolicyDraftEditor();
      setShowCreateForm(false);
      setActionMessage("Group created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const deleteGroup = async (name: string) => {
    if (needsS3AccountSelection) return;
    setBusy(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamGroup(accountIdForApi, name);
      setActionMessage("Group deleted");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = (name: string) => {
    if (needsS3AccountSelection) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete IAM group?",
      description: "Permanently remove this IAM group from the selected account.",
      confirmLabel: "Delete group",
      details: [{ label: "IAM group", value: name }],
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
    { id: "name", label: "Name", primary: true, mobileRole: "primary", render: (group) => group.name },
    { id: "arn", label: "ARN", render: (group) => group.arn ?? "-" },
    {
      id: "policies",
      label: "Policies",
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
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (group) => (
        <ListActions>
          <ListActionLink to={`/manager/groups/${encodeURIComponent(group.name)}/users`}>
            Members
          </ListActionLink>
          <ListActionLink to={`/manager/groups/${encodeURIComponent(group.name)}/policies`}>
            Policies
          </ListActionLink>
          <ListActionButton
            onClick={() => handleDelete(group.name)}
             variant="danger"
            disabled={busy === group.name}
          >
            {busy === group.name ? "Deleting..." : "Delete"}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateForm)}>
      <PageHeader actionPresentation="listing"
        title="IAM Groups"
        description="Manage groups using the account root keys."
        breadcrumbs={managerPageBreadcrumbs("groups")}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: "Create group",
                  onClick: openCreateForm,
                },
              ]
            : []
        }
      />

      {!showCreateForm && error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing IAM groups"
          description="Groups are scoped to an execution context. Choose an account to list membership containers and attach shared policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM groups are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage account-level IAM groups."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title="Groups"
            countLabel={`${filteredGroups.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={groupFilter}
                onChange={setGroupFilter}
                placeholder="Search by name or ARN"
              />
            }
        >
          <DataTableShell
            columns={groupTableColumns}
            rows={filteredGroups}
            rowKey={(group) => group.name}
            status={filteredTableStatus}
            loadingMessage="Loading groups..."
            errorMessage="Unable to load groups."
            emptyMessage="No groups."
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showCreateForm && (
        <SettingsWorkflowForm
          title="Create IAM group"
          description="Create a group and assign its managed and inline policies."
          breadcrumbs={managerPageBreadcrumbs("groups", { label: "Create" })}
          backLabel="Back to groups"
          onClose={closeCreateForm}
          contentVariant="plain"
          dirty={advancedCurrentSignature !== advancedInitialSignature}
          error={error} onSubmit={handleAdvancedCreate}
          busy={busy !== null} disabled={needsS3AccountSelection}
          submitLabel="Create group" busyLabel="Creating..."
        >
          <SettingsSection title="Identity" presentation="compact">
            <div className="settings-fields">
              <UiInput label="Group name" required value={advancedName} onChange={(event) => setAdvancedName(event.target.value)}
                placeholder="Group name" error={advancedValidationAttempted && !advancedName.trim() ? "Group name is required." : undefined} />
            </div>
          </SettingsSection>
          <ManagedPolicySelectionPanel
            title="Attach policies"
            description="Select managed policies to link immediately."
            emptyMessage="No policies available. Create them first."
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
