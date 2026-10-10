/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { iamNameFormatError } from "../../utils/resourceNames";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { IamPolicy, createIamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import SettingsJsonEditor from "../../components/settings/SettingsJsonEditor";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInput from "../../components/ui/UiInput";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { useManagerIamCollection } from "./useManagerIamCollection";
import { useManagerI18n } from "./managerI18n";

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

export default function PoliciesPage() {
  const { text } = useManagerI18n();
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
  const [showCreateForm, setShowCreateForm] = useState(false);
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

  const nameFormatError = iamNameFormatError(advancedName.trim(), "policy");

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || isS3User || creating) return;
    setValidationAttempted(true);
    if (!advancedName.trim() || nameFormatError || documentError) {
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
      setShowCreateForm(false);
      setActionMessage(text("Policy created"));
      await load(accountIdForApi);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setCreating(false);
    }
  };

  const openCreateForm = () => {
    setError(null);
    setValidationAttempted(false);
    setAdvancedInitialSignature(stableSignature({ advancedName, documentText }));
    setShowCreateForm(true);
  };

  const closeCreateForm = () => {
    setShowCreateForm(false);
    setAdvancedName("");
    setDocumentText(DEFAULT_POLICY_DOCUMENT);
    setAdvancedInitialSignature(stableSignature({ advancedName: "", documentText: DEFAULT_POLICY_DOCUMENT }));
  };

  const advancedCurrentSignature = useMemo(
    () => stableSignature({ advancedName, documentText }),
    [advancedName, documentText]
  );

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
    <div className={workflowPageHostClass(showCreateForm)}>
      <PageHeader actionPresentation="listing"
        title={text("IAM Policies")}
        description={text("List and create Ceph IAM policies for the selected account.")}
        breadcrumbs={managerPageBreadcrumbs(text, "policies")}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: text("Create policy"),
                  onClick: openCreateForm,
                },
              ]
            : []
        }
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {!showCreateForm && error && <PageBanner tone="error">{text(error)}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title={text("Select an account before managing IAM policies")}
          description={text("Policies are created inside an execution context. Choose an account to list, create, and attach managed IAM policies.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title={text("IAM policies are unavailable for managed S3 user contexts")}
          description={text("Switch to an RGW account or S3 connection context to manage reusable IAM policies.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title={text("Policies")}
            countLabel={text(filteredPolicies.length === 1 ? "{count} result" : "{count} results", { count: filteredPolicies.length })}
            search={
              <ManagerToolbarSearch
                value={policyFilter}
                onChange={setPolicyFilter}
                placeholder={text("Search by name or ARN")}
              />
            }
        >
          <DataTableShell
            columns={policyTableColumns}
            rows={filteredPolicies}
            rowKey={(policy) => policy.arn}
            status={filteredTableStatus}
            loadingMessage={text("Loading policies...")}
            errorMessage={text("Unable to load policies.")}
            emptyMessage={text("No policies.")}
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showCreateForm && (
        <SettingsWorkflowForm
          title={text("Create IAM policy")}
          description={text("Create a reusable IAM policy from its JSON document.")}
          breadcrumbs={managerPageBreadcrumbs(text, "policies", { label: text("Create") })}
          backLabel={text("Back to policies")}
          onClose={closeCreateForm}
          contentVariant="plain"
          dirty={advancedCurrentSignature !== advancedInitialSignature}
          error={error} onSubmit={handleAdvancedCreate}
          busy={creating} disabled={needsS3AccountSelection || isS3User}
          submitLabel={text("Create policy")} busyLabel={text("Creating...")}
        >
          <SettingsSection title={text("Identity")} presentation="compact">
            <div className="settings-fields">
              <UiInput label={text("Policy name")} required value={advancedName} onChange={(event) => setAdvancedName(event.target.value)}
                placeholder={text("Policy name")} error={nameFormatError ? text(nameFormatError!) : validationAttempted && !advancedName.trim() ? text("Policy name is required.") : undefined} />
            </div>
          </SettingsSection>
          <SettingsSection title={text("Policy document")} presentation="compact">
            <div className="settings-fields">
              <SettingsJsonEditor label={text("Policy document (JSON)")} value={documentText} onChange={setDocumentText}
                rows={10} error={validationAttempted ? documentError : undefined}
                hint={text("Provide a valid IAM policy JSON document. You can start from the default template and customize statements.")} />
            </div>
          </SettingsSection>
        </SettingsWorkflowForm>
      )}
    </div>
  );
}
