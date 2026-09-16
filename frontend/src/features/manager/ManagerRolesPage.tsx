/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListBadge, ListActionButton, ListActionLink } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { S3AccountSelector } from "../../api/accountParams";
import {
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
import ManagerRoleFormFields from "./ManagerRoleFormFields";
import ManagerRoleEditor from "./ManagerRoleEditor";
import { DEFAULT_ASSUME_ROLE_DOCUMENT, DEFAULT_ROLE_PATH, parseIamRolePolicy } from "./iamRoleForm";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function ManagerRolesPage() {
  const deleteConfirmation = useConfirmActionDialog();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
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
  const [advancedPath, setAdvancedPath] = useState(DEFAULT_ROLE_PATH);
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
      assumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT,
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    })
  );
  const [editingRoleName, setEditingRoleName] = useState<string | null>(null);
  const advancedPolicy = parseIamRolePolicy(assumeRolePolicyText);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadPolicies = useCallback(
    (accountId: S3AccountSelector) =>
      loadRelated(accountId, listIamPolicies, setPolicies),
    [loadRelated],
  );

  useEffect(() => {
    if (needsS3AccountSelection) {
      setRoles([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
    loadPolicies(accountIdForApi);
    resetInlinePolicyDraftEditor();
  }, [accountIdForApi, needsS3AccountSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor, setLoading, setRoles]);

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
        assumeRolePolicyText,
        selectedPolicies,
        inlineDrafts,
        inlineDraftName,
        inlinePolicyText,
      }),
    [
      advancedName,
      advancedPath,
      assumeRolePolicyText,
      inlineDraftName,
      inlineDrafts,
      inlinePolicyText,
      selectedPolicies,
    ]
  );
  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || creating) return;
    setAdvancedValidationAttempted(true);
    if (!advancedName.trim() || advancedPolicy.error) {
      focusFirstInvalidField(e.currentTarget as HTMLFormElement);
      return;
    }
    const trimmedPath = advancedPath.trim();
    setCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      const roleName = advancedName.trim();
      await createIamRole(accountIdForApi, {
        name: roleName,
        path: trimmedPath === "" ? undefined : trimmedPath,
        assume_role_policy_document: advancedPolicy.document,
        inline_policies: inlineDrafts,
      });
      if (selectedPolicies.length > 0) {
        for (const arn of selectedPolicies) {
          const policy = policies.find((p) => p.arn === arn);
          if (policy) {
            await attachRolePolicy(accountIdForApi, roleName, policy);
          }
        }
      }
      setAdvancedName("");
      setAdvancedPath(DEFAULT_ROLE_PATH);
      setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
      setSelectedPolicies([]);
      setPolicySearch("");
      setShowPolicyOptions(false);
      resetInlinePolicyDraftEditor();
      setShowCreateForm(false);
      setActionMessage("Role created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const deleteRole = async (name: string) => {
    if (needsS3AccountSelection) return;
    setDeletingRole(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamRole(accountIdForApi, name);
      setActionMessage("Role deleted");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setDeletingRole(null);
    }
  };

  const handleDelete = (name: string) => {
    if (needsS3AccountSelection) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete IAM role?",
      description: "Permanently remove this IAM role from the selected account.",
      confirmLabel: "Delete role",
      details: [{ label: "IAM role", value: name }],
      impacts: ["Workloads that assume this role will no longer receive its permissions."],
      onConfirm: () => deleteRole(name),
    });
  };

  const openCreateForm = () => {
    setError(null);
    setAdvancedValidationAttempted(false);
    setAdvancedName("");
    setAdvancedPath(DEFAULT_ROLE_PATH);
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
    { id: "name", label: "Name", primary: true, mobileRole: "primary", render: (role) => role.name },
    { id: "path", label: "Path", render: (role) => role.path ?? "-" },
    { id: "arn", label: "ARN", render: (role) => role.arn ?? "-" },
    {
      id: "policies",
      label: "Policies",
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
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (role) => (
        <ListActions>
          <ListActionButton
            onClick={() => { setError(null); setEditingRoleName(role.name); }}
          >
            Edit
          </ListActionButton>
          <ListActionLink to={`/manager/roles/${encodeURIComponent(role.name)}/policies`}>
            Policies
          </ListActionLink>
          <ListActionButton
            onClick={() => handleDelete(role.name)}
             variant="danger"
            disabled={deletingRole === role.name}
          >
            {deletingRole === role.name ? "Deleting..." : "Delete"}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateForm || Boolean(editingRoleName))}>
      <PageHeader actionPresentation="listing"
        title="IAM Roles"
        description="Manage roles using the account root keys."
        breadcrumbs={managerPageBreadcrumbs("roles")}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: "Create role",
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
          title="Select an account before managing IAM roles"
          description="Roles are defined per execution context. Choose an account to list trust relationships and attached policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM roles are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage role trust policies and attached permissions."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title="Roles"
            countLabel={`${filteredRoles.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={roleFilter}
                onChange={setRoleFilter}
                placeholder="Search by name, path, or ARN"
              />
            }
        >
          <DataTableShell
            columns={roleTableColumns}
            rows={filteredRoles}
            rowKey={(role) => role.name}
            status={filteredTableStatus}
            loadingMessage="Loading roles..."
            errorMessage="Unable to load roles."
            emptyMessage="No roles."
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showCreateForm && (
        <SettingsWorkflowForm
          title="Create IAM role"
          description="Configure the role path, trust policy and assigned permissions."
          breadcrumbs={managerPageBreadcrumbs("roles", { label: "Create" })}
          backLabel="Back to roles"
          onClose={closeCreateForm}
          contentVariant="plain"
          dirty={advancedCurrentSignature !== advancedInitialSignature}
          error={error} onSubmit={handleAdvancedCreate}
          busy={creating} disabled={needsS3AccountSelection}
          submitLabel="Create role" busyLabel="Creating..."
        >
          <ManagerRoleFormFields name={advancedName} path={advancedPath} policy={assumeRolePolicyText}
            onNameChange={setAdvancedName} onPathChange={setAdvancedPath} onPolicyChange={setAssumeRolePolicyText}
            nameError={advancedValidationAttempted && !advancedName.trim() ? "Role name is required." : undefined}
            policyError={advancedValidationAttempted ? advancedPolicy.error : undefined} />
          <ManagedPolicySelectionPanel
            title="Attach policies"
            description="Select managed policies to grant permissions immediately."
            emptyMessage="No policies available. Create them first."
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
      {editingRoleName && <ManagerRoleEditor
        key={`${accountIdForApi}:${editingRoleName}`} accountId={accountIdForApi} roleName={editingRoleName}
        onClose={() => setEditingRoleName(null)} onSaved={() => {
          setEditingRoleName(null);
          setActionMessage("Role updated");
          void load(accountIdForApi);
        }} />}
      {deleteConfirmation.confirmationDialog}
    </div>
  );
}
