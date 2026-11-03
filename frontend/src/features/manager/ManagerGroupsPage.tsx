/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { iamNameFormatError } from "../../utils/resourceNames";
import { ListActions, ListActionLink, ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useEffect, useState } from "react";

import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { IAMGroup, createIamGroup, deleteIamGroup, listIamGroupsPage } from "../../api/managerIamGroups";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { dataTableDefaultActionProps, type DataTableColumn } from "../../components/list/DataTableShell";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { workflowPageHostClass } from "../../components/WorkflowPage";

import { extractApiError } from "../../utils/apiError";
import { useSettingsBaseline } from "../../components/settings/useSettingsDraft";
import InlinePolicyDraftEditor from "./InlinePolicyDraftEditor";
import ManagedPolicySelectionPanel from "./ManagedPolicySelectionPanel";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import ManagerIamPoliciesCell from "./ManagerIamPoliciesCell";
import { useInlinePolicyDraftEditor } from "./useInlinePolicyDraftEditor";
import { useManagedPolicySelection } from "./useManagedPolicySelection";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";
import IamCursorPaginationControls from "./IamCursorPaginationControls";
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
  const {
    error,
    items: groups,
    load,
    loading,
    setError,
    setItems: setGroups,
    setLoading,
    search: groupFilter,
    setSearch: setGroupFilter,
    page,
    pageSize,
    setPageSize,
    canPrevious,
    canNext,
    previousPage,
    nextPage,
  } = useManagerIamCursorCollection(listIamGroupsPage, { includeDetails: true });
  const {
    editorProps: inlinePolicyEditorProps,
    inlineDraftName,
    inlineDrafts,
    inlinePolicyText,
    resetInlinePolicyDraftEditor,
    validateInlineDrafts,
  } = useInlinePolicyDraftEditor(setError, "group", namingValidationProfile);
  const [advancedName, setAdvancedName] = useState("");
  const [advancedValidationAttempted, setAdvancedValidationAttempted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const {
    loadPolicies,
    panel: managedPolicySelection,
    resetPolicySelection,
    selectedPolicies,
    setPolicies,
  } = useManagedPolicySelection();

  useEffect(() => {
    resetPolicySelection();
    if (needsContextSelection) {
      setGroups([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(contextIdForApi);
    loadPolicies(contextIdForApi);
    resetInlinePolicyDraftEditor();
  }, [contextIdForApi, needsContextSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor, resetPolicySelection, setGroups, setLoading, setPolicies]);

  const advancedDraft = {
    advancedName,
    selectedPolicies,
    inlineDrafts,
    inlineDraftName,
    inlinePolicyText,
  };
  const { accept: acceptAdvancedDraft, dirty: advancedDraftDirty } = useSettingsBaseline(
    advancedDraft,
    {
      advancedName: "",
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    },
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
      await createIamGroup(contextIdForApi, {
        name: groupName,
        policies: selectedPolicies,
        inline_policies: inlineDrafts,
      });
      setAdvancedName("");
      resetPolicySelection();
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
    resetPolicySelection();
    resetInlinePolicyDraftEditor();
    setShowCreateForm(true);
    acceptAdvancedDraft({
      advancedName: "",
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    });
  };

  const closeCreateForm = () => {
    setShowCreateForm(false);
    setAdvancedName("");
    resetPolicySelection();
    resetInlinePolicyDraftEditor();
  };


  const filteredGroups = groups;
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
      render: (group) => (
        <ManagerIamPoliciesCell
          managedPolicies={group.policies}
          inlinePolicies={group.inline_policies}
        />
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

      {!showCreateForm && error && filteredTableStatus !== "error" && <PageBanner tone="error">{text(error)}</PageBanner>}
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
            countLabel={text("{count} shown on this page", { count: filteredGroups.length })}
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
            errorMessage={error ? text(error) : text("Unable to load groups.")}
            emptyMessage={text("No groups.")}
            responsiveCards
            tableLayout="fixed"
          />
          <IamCursorPaginationControls
            page={page}
            pageSize={pageSize}
            canPrevious={canPrevious}
            canNext={canNext}
            disabled={loading}
            onPrevious={previousPage}
            onNext={nextPage}
            onPageSizeChange={setPageSize}
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
          dirty={advancedDraftDirty}
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
            title={text("Attach policies (optional)")}
            description={text("Select managed policies to link immediately.")}
            emptyMessage={text("No policies available. Create them first.")}
            footer="Policies can also be attached later from the group page."
            selection={managedPolicySelection}
          />
          <InlinePolicyDraftEditor {...inlinePolicyEditorProps} />
        </SettingsWorkflowForm>
      )}
      {deleteConfirmation.confirmationDialog}
    </div>
  );
}
