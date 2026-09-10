/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { IamPolicy, createIamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import SettingsForm from "../../components/settings/SettingsForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { useManagerIamCollection } from "./useManagerIamCollection";

const DEFAULT_POLICY_DOCUMENT = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [],
  },
  null,
  2
);

const policyTableColumns: Array<DataTableColumn<IamPolicy>> = [
  { id: "name", label: "Name", primary: true, mobileRole: "primary", render: (policy) => policy.name },
  { id: "arn", label: "ARN", render: (policy) => policy.arn },
  { id: "version", label: "Version", render: (policy) => policy.default_version_id ?? "-" },
];

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function PoliciesPage() {
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [policyFilter, setPolicyFilter] = useState("");
  const {
    error,
    items: policies,
    load,
    loading,
    setError,
    setItems: setPolicies,
    setLoading,
  } = useManagerIamCollection(listIamPolicies);
  const [advancedName, setAdvancedName] = useState("");
  const [documentText, setDocumentText] = useState(DEFAULT_POLICY_DOCUMENT);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  let parsedDocument: Record<string, unknown> | undefined;
  let documentError: string | undefined;
  try {
    parsedDocument = JSON.parse(documentText);
  } catch {
    documentError = "Policy document must be valid JSON.";
  }
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({ advancedName: "", documentText: DEFAULT_POLICY_DOCUMENT })
  );

  useEffect(() => {
    if (needsS3AccountSelection) {
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
  }, [accountIdForApi, needsS3AccountSelection, accessMode, load, setLoading, setPolicies]);

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || isS3User || creating) return;
    setValidationAttempted(true);
    if (!advancedName.trim() || documentError) {
      focusFirstInvalidField(e.currentTarget as HTMLFormElement);
      return;
    }
    setCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      await createIamPolicy(accountIdForApi, advancedName.trim(), parsedDocument!);
      setAdvancedName("");
      setDocumentText(DEFAULT_POLICY_DOCUMENT);
      setShowAdvancedModal(false);
      setActionMessage("Policy created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const openAdvancedModal = () => {
    setError(null);
    setValidationAttempted(false);
    setAdvancedInitialSignature(stableSignature({ advancedName, documentText }));
    setShowAdvancedModal(true);
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
    setAdvancedName("");
    setDocumentText(DEFAULT_POLICY_DOCUMENT);
    setAdvancedInitialSignature(stableSignature({ advancedName: "", documentText: DEFAULT_POLICY_DOCUMENT }));
  };

  const advancedCurrentSignature = useMemo(
    () => stableSignature({ advancedName, documentText }),
    [advancedName, documentText]
  );
  const advancedCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedModal && advancedCurrentSignature !== advancedInitialSignature,
    onClose: closeAdvancedModal,
    disabled: creating,
  });

  const filteredPolicies = policies.filter((policy) => {
    const needle = policyFilter.trim().toLowerCase();
    if (!needle) return true;
    return policy.name.toLowerCase().includes(needle) || policy.arn.toLowerCase().includes(needle);
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredPolicies.length,
  });

  return (
    <div className={workflowPageHostClass(showAdvancedModal)}>
      <PageHeader actionPresentation="listing"
        title="IAM Policies"
        description="List and create Ceph IAM policies for the selected account."
        breadcrumbs={managerPageBreadcrumbs("policies")}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: "Create policy",
                  onClick: openAdvancedModal,
                },
              ]
            : []
        }
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing IAM policies"
          description="Policies are created inside an execution context. Choose an account to list, create, and attach managed IAM policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM policies are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage reusable IAM policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title="Policies"
            countLabel={`${filteredPolicies.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={policyFilter}
                onChange={setPolicyFilter}
                placeholder="Search by name or ARN"
              />
            }
        >
          <DataTableShell
            columns={policyTableColumns}
            rows={filteredPolicies}
            rowKey={(policy) => policy.arn}
            status={filteredTableStatus}
            loadingMessage="Loading policies..."
            errorMessage="Unable to load policies."
            emptyMessage="No policies."
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showAdvancedModal && (
        <WorkflowPage
          title="Create IAM policy"
          description="Name the policy and edit its complete JSON document with page-level space."
          breadcrumbs={managerPageBreadcrumbs("policies", { label: "Create" })}
          backLabel="Back to policies"
          onBack={advancedCloseGuard.requestClose}
          width="standard"
          contentVariant="plain"
        >
          {error && <PageBanner tone="error">{error}</PageBanner>}
          <SettingsForm label="Create IAM policy" onSubmit={handleAdvancedCreate}
            busy={creating} disabled={needsS3AccountSelection || isS3User} onCancel={advancedCloseGuard.requestClose}
            submitLabel="Create policy" busyLabel="Creating...">
            <SettingsSection title="Identity" presentation="compact">
              <div className="settings-fields">
                <UiInput label="Policy name" required value={advancedName} onChange={(event) => setAdvancedName(event.target.value)}
                  placeholder="Policy name" error={validationAttempted && !advancedName.trim() ? "Policy name is required." : undefined} />
              </div>
            </SettingsSection>
            <SettingsSection title="Policy document" presentation="compact">
              <div className="settings-fields">
                <UiTextarea label="Policy document (JSON)" value={documentText} onChange={(event) => setDocumentText(event.target.value)}
                  className="font-mono" rows={10} spellCheck={false} error={validationAttempted ? documentError : undefined}
                  hint="Provide a valid IAM policy JSON document. You can start from the default template and customize statements." />
              </div>
            </SettingsSection>
          </SettingsForm>
          {advancedCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
    </div>
  );
}
