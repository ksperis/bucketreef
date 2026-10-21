/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { iamNameFormatError } from "../../utils/resourceNames";
import { ListActions, ListBadge, ListActionButton, ListActionLink } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import {
  IAMTag,
  IAMRole,
  attachRolePolicy,
  createIamRole,
  deleteIamRole,
  listIamRoles,
} from "../../api/managerIamRoles";
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
import ManagerRoleFormFields from "./ManagerRoleFormFields";
import ManagerRoleTagsEditor, { roleTagError } from "./ManagerRoleTagsEditor";
import { DEFAULT_ASSUME_ROLE_DOCUMENT, DEFAULT_ROLE_PATH, parseIamRolePolicy } from "./iamRoleForm";
import { iamPathFormatError, roleMaxSessionDurationError } from "./iamIdentityForm";
import { useManagerI18n } from "./managerI18n";

export default function ManagerRolesPage() {
  const { text } = useManagerI18n();
  const deleteConfirmation = useConfirmActionDialog();
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode, namingValidationProfile } = useS3AccountContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";
  const [roleFilter, setRoleFilter] = useState("");
  const {
    error,
    items: roles,
    load,
    loadRelated,
    loading,
    setError,
    setItems: setRoles,
    setLoading,
  } = useManagerIamCollection(listIamRoles);
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
  } = useInlinePolicyDraftEditor(setError, "role", namingValidationProfile);
  const [advancedName, setAdvancedName] = useState("");
  const [advancedValidationAttempted, setAdvancedValidationAttempted] = useState(false);
  const [advancedPath, setAdvancedPath] = useState(DEFAULT_ROLE_PATH);
  const [advancedMaxSessionDuration, setAdvancedMaxSessionDuration] = useState(3600);
  const [advancedTags, setAdvancedTags] = useState<IAMTag[]>([]);
  const [assumeRolePolicyText, setAssumeRolePolicyText] = useState(DEFAULT_ASSUME_ROLE_DOCUMENT);
  const [creating, setCreating] = useState(false);
  const [deletingRole, setDeletingRole] = useState<string | null>(null);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({
      advancedName: "",
      advancedPath: DEFAULT_ROLE_PATH,
      advancedMaxSessionDuration: 3600,
      advancedTags: [],
      assumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT,
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    })
  );
  const advancedPolicy = parseIamRolePolicy(assumeRolePolicyText);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadPolicies = useCallback(
    (accountId: S3ExecutionContextSelector) =>
      loadRelated(accountId, listIamPolicies, setPolicies),
    [loadRelated],
  );

  useEffect(() => {
    if (needsContextSelection) {
      setRoles([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(contextIdForApi);
    loadPolicies(contextIdForApi);
    resetInlinePolicyDraftEditor();
  }, [contextIdForApi, needsContextSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor, setLoading, setRoles]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  const advancedCurrentSignature = useMemo(
    () =>
      stableSignature({
        advancedName,
        advancedPath,
        advancedMaxSessionDuration,
        advancedTags,
        assumeRolePolicyText,
        selectedPolicies,
        inlineDrafts,
        inlineDraftName,
        inlinePolicyText,
      }),
    [
      advancedName,
      advancedPath,
      advancedMaxSessionDuration,
      advancedTags,
      assumeRolePolicyText,
      inlineDraftName,
      inlineDrafts,
      inlinePolicyText,
      selectedPolicies,
    ]
  );
  const nameFormatError = iamNameFormatError(advancedName.trim(), "role");
  const pathFormatError = advancedPath.trim() ? iamPathFormatError(advancedPath.trim()) : undefined;
  const maxSessionDurationError = roleMaxSessionDurationError(advancedMaxSessionDuration);
  const tagsError = advancedTags.find(roleTagError) ? "Fix invalid role tags before continuing." : undefined;

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsContextSelection || creating) return;
    setAdvancedValidationAttempted(true);
    if (!advancedName.trim() || nameFormatError || pathFormatError || maxSessionDurationError || tagsError || advancedPolicy.error || !validateInlineDrafts()) {
      focusFirstInvalidField(e.currentTarget as HTMLFormElement);
      return;
    }
    const trimmedPath = advancedPath.trim();
    setCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      const roleName = advancedName.trim();
      await createIamRole(contextIdForApi, {
        name: roleName,
        path: trimmedPath === "" ? undefined : trimmedPath,
        assume_role_policy_document: advancedPolicy.document,
        max_session_duration: advancedMaxSessionDuration,
        tags: advancedTags,
        inline_policies: inlineDrafts,
      });
      if (selectedPolicies.length > 0) {
        for (const arn of selectedPolicies) {
          const policy = policies.find((p) => p.arn === arn);
          if (policy) {
            await attachRolePolicy(contextIdForApi, roleName, policy);
          }
        }
      }
      setAdvancedName("");
      setAdvancedPath(DEFAULT_ROLE_PATH);
      setAdvancedMaxSessionDuration(3600);
      setAdvancedTags([]);
      setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
      setSelectedPolicies([]);
      setPolicySearch("");
      setShowPolicyOptions(false);
      resetInlinePolicyDraftEditor();
      setShowCreateForm(false);
      setActionMessage(text("Role created"));
      await load(contextIdForApi);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setCreating(false);
    }
  };

  const deleteRole = async (name: string) => {
    if (needsContextSelection) return;
    setDeletingRole(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamRole(contextIdForApi, name);
      setActionMessage(text("Role deleted"));
      await load(contextIdForApi);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setDeletingRole(null);
    }
  };

  const handleDelete = (name: string) => {
    if (needsContextSelection) return;
    deleteConfirmation.requestConfirmation({
      title: text("Delete IAM role?"),
      description: text("Permanently remove this IAM role from the selected account."),
      confirmLabel: text("Delete role"),
      details: [{ label: text("IAM role"), value: name }],
      impacts: ["Workloads that assume this role will no longer receive its permissions."],
      onConfirm: () => deleteRole(name),
    });
  };

  const openCreateForm = () => {
    setError(null);
    setAdvancedValidationAttempted(false);
    setAdvancedName("");
    setAdvancedPath(DEFAULT_ROLE_PATH);
    setAdvancedMaxSessionDuration(3600);
    setAdvancedTags([]);
    setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
    setShowCreateForm(true);
    setAdvancedInitialSignature(
      stableSignature({
        advancedName: "",
        advancedPath: DEFAULT_ROLE_PATH,
        advancedMaxSessionDuration: 3600,
        advancedTags: [],
        assumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT,
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
    setAdvancedPath(DEFAULT_ROLE_PATH);
    setAdvancedMaxSessionDuration(3600);
    setAdvancedTags([]);
    setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
  };

  const filteredRoles = roles.filter((role) => {
    const needle = roleFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      role.name.toLowerCase().includes(needle) ||
      (role.path ?? "").toLowerCase().includes(needle) ||
      (role.arn ?? "").toLowerCase().includes(needle)
    );
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredRoles.length,
  });
  const roleTableColumns: Array<DataTableColumn<IAMRole>> = [
    { id: "name", label: text("Name"), primary: true, mobileRole: "primary", render: (role) => role.name },
    { id: "path", label: text("Path"), render: (role) => role.path ?? "-" },
    { id: "arn", label: text("ARN"), render: (role) => role.arn ?? "-" },
    {
      id: "policies",
      label: text("Policies"),
      cellClassName: "ui-table-wide",
      render: (role) =>
        role.policies && role.policies.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {role.policies.map((policy) => (
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
      render: (role) => (
        <ListActions>
          <ListActionLink
            to={`/manager/roles/${encodeURIComponent(role.name)}`}
            {...dataTableDefaultActionProps}
          >
            {text("Edit")}
          </ListActionLink>
          <ListActionButton
            onClick={() => handleDelete(role.name)}
             variant="danger"
            disabled={deletingRole === role.name}
          >
            {text(deletingRole === role.name ? "Deleting..." : "Delete")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateForm)}>
      <PageHeader actionPresentation="listing"
        title={text("IAM Roles")}
        description={text("Manage roles using the account root keys.")}
        breadcrumbs={managerPageBreadcrumbs(text, "roles")}
        actions={
          !needsContextSelection && !isS3User
            ? [
                {
                  label: text("Create role"),
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
          title={text("Select an account before managing IAM roles")}
          description={text("Roles are defined per execution context. Choose an account to list trust relationships and attached policies.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title={text("IAM roles are unavailable for managed S3 user contexts")}
          description={text("Switch to an RGW account or S3 connection context to manage role trust policies and attached permissions.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title={text("Roles")}
            countLabel={text(filteredRoles.length === 1 ? "{count} result" : "{count} results", { count: filteredRoles.length })}
            search={
              <ManagerToolbarSearch
                value={roleFilter}
                onChange={setRoleFilter}
                placeholder={text("Search by name, path, or ARN")}
              />
            }
        >
          <DataTableShell
            columns={roleTableColumns}
            rows={filteredRoles}
            rowKey={(role) => role.name}
            status={filteredTableStatus}
            loadingMessage={text("Loading roles...")}
            errorMessage={text("Unable to load roles.")}
            emptyMessage={text("No roles.")}
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showCreateForm && (
        <SettingsWorkflowForm
          title={text("Create IAM role")}
          description={text("Configure the role path, trust policy and assigned permissions.")}
          breadcrumbs={managerPageBreadcrumbs(text, "roles", { label: text("Create") })}
          backLabel={text("Back to roles")}
          onClose={closeCreateForm}
          contentVariant="plain"
          dirty={advancedCurrentSignature !== advancedInitialSignature}
          error={error} onSubmit={handleAdvancedCreate}
          busy={creating} disabled={needsContextSelection || namingValidationProfile === null}
          submitLabel={text("Create role")} busyLabel={text("Creating...")}
        >
          <ManagerRoleFormFields name={advancedName} path={advancedPath} policy={assumeRolePolicyText}
            maxSessionDuration={advancedMaxSessionDuration}
            onNameChange={setAdvancedName} onPathChange={setAdvancedPath} onPolicyChange={setAssumeRolePolicyText}
            onMaxSessionDurationChange={setAdvancedMaxSessionDuration}
            nameError={nameFormatError ? text(nameFormatError!) : advancedValidationAttempted && !advancedName.trim() ? text("Role name is required.") : undefined}
            pathError={advancedValidationAttempted ? pathFormatError : undefined}
            policyError={advancedValidationAttempted ? advancedPolicy.error : undefined}
            maxSessionDurationError={advancedValidationAttempted ? maxSessionDurationError : undefined} />
          <ManagerRoleTagsEditor tags={advancedTags} onChange={setAdvancedTags} />
          <ManagedPolicySelectionPanel
            title={text("Attach policies")}
            description={text("Select managed policies to grant permissions immediately.")}
            emptyMessage={text("No policies available. Create them first.")}
            footer="Policies can also be attached later from the role page."
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
            entityLabel="role"
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
