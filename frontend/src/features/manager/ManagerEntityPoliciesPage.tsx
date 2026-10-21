/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import InlinePolicyEditor from "./InlinePolicyEditor";
import UiSelect from "../../components/ui/UiSelect";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";

type ManagerPolicyEntityType = "user" | "group" | "role";

type PageAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "ghost" | "secondary" | "primary" | "danger";
};

type ManagerEntityPoliciesPageProps = {
  entityType: ManagerPolicyEntityType;
  routeParam: "userName" | "groupName" | "roleName";
  listPoliciesForEntity: (accountId: S3ExecutionContextSelector, entityName: string) => Promise<IamPolicy[]>;
  attachPolicyToEntity: (accountId: S3ExecutionContextSelector, entityName: string, policy: IamPolicy) => Promise<IamPolicy>;
  detachPolicyFromEntity: (accountId: S3ExecutionContextSelector, entityName: string, policyArn: string) => Promise<void>;
  listInlinePoliciesForEntity: (accountId: S3ExecutionContextSelector, entityName: string) => Promise<{ name: string; document: Record<string, unknown> }[]>;
  putInlinePolicyForEntity: (
    accountId: S3ExecutionContextSelector,
    entityName: string,
    policyName: string,
    document: Record<string, unknown>
  ) => Promise<{ name: string; document: Record<string, unknown> }>;
  deleteInlinePolicyForEntity: (accountId: S3ExecutionContextSelector, entityName: string, policyName: string) => Promise<void>;
  extraActions?: (entityName: string) => PageAction[];
  embedded?: boolean;
};

type EntityPageConfig = {
  title: string;
  singularLabel: string;
  pluralLabel: string;
  managerRoute: string;
};

const ENTITY_CONFIG: Record<ManagerPolicyEntityType, EntityPageConfig> = {
  user: {
    title: "User policies",
    singularLabel: "user",
    pluralLabel: "users",
    managerRoute: "/manager/users",
  },
  group: {
    title: "Group policies",
    singularLabel: "group",
    pluralLabel: "groups",
    managerRoute: "/manager/groups",
  },
  role: {
    title: "Role policies",
    singularLabel: "role",
    pluralLabel: "roles",
    managerRoute: "/manager/roles",
  },
};

export default function ManagerEntityPoliciesPage({
  entityType,
  routeParam,
  listPoliciesForEntity,
  attachPolicyToEntity,
  detachPolicyFromEntity,
  listInlinePoliciesForEntity,
  putInlinePolicyForEntity,
  deleteInlinePolicyForEntity,
  extraActions,
  embedded = false,
}: ManagerEntityPoliciesPageProps) {
  const { text } = useManagerI18n();
  const config = ENTITY_CONFIG[entityType];
  const singularLabel = text(config.singularLabel);
  const pluralLabel = text(config.pluralLabel);
  const parentPageId = {
    user: "users",
    group: "groups",
    role: "roles",
  } as const;
  const params = useParams();
  const rawEntityName = params[routeParam];
  const { selectedS3AccountType, contextIdForApi, requiresS3AccountSelection, accessMode, namingValidationProfile } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !contextIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";

  const [attached, setAttached] = useState<IamPolicy[]>([]);
  const [available, setAvailable] = useState<IamPolicy[]>([]);
  const [selectedArn, setSelectedArn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const policyConfirmation = useConfirmActionDialog();

  const decodedEntity = useMemo(() => {
    if (!rawEntityName) return "";
    try {
      return decodeURIComponent(rawEntityName);
    } catch {
      return rawEntityName;
    }
  }, [rawEntityName]);

  const noPoliciesAvailable = available.length === 0;

  const load = useCallback(async (accountId: S3ExecutionContextSelector, entityName: string) => {
    setLoading(true);
    setError(null);
    try {
      const [attachedPolicies, allPolicies] = await Promise.all([
        listPoliciesForEntity(accountId, entityName),
        listIamPolicies(accountId),
      ]);
      setAttached(attachedPolicies);
      setAvailable(allPolicies);
      const firstFree = allPolicies.find((policy) => !attachedPolicies.some((candidate) => candidate.arn === policy.arn));
      setSelectedArn(firstFree?.arn ?? "");
    } catch (err) {
      setError(extractApiError(err, text("Unexpected error")));
    } finally {
      setLoading(false);
    }
  }, [listPoliciesForEntity, text]);

  useEffect(() => {
    if (isS3User) {
      setAttached([]);
      setAvailable([]);
      setLoading(false);
      return;
    }
    if (needsS3AccountSelection) {
      setAttached([]);
      setAvailable([]);
      setLoading(false);
      return;
    }
    if (rawEntityName) {
      load(contextIdForApi, rawEntityName);
    }
  }, [accessMode, contextIdForApi, isS3User, load, needsS3AccountSelection, rawEntityName]);

  const handleRefresh = () => {
    if (needsS3AccountSelection || !rawEntityName) return;
    load(contextIdForApi, rawEntityName);
  };

  const handleAttach = async (event: FormEvent) => {
    event.preventDefault();
    if (needsS3AccountSelection || !rawEntityName || !selectedArn || busy !== null || loading) return;
    const policy = available.find((candidate) => candidate.arn === selectedArn);
    if (!policy) return;
    setBusy("attach");
    setError(null);
    setActionMessage(null);
    try {
      await attachPolicyToEntity(contextIdForApi, rawEntityName, policy);
      await load(contextIdForApi, rawEntityName);
      setActionMessage(text("Policy attached"));
    } catch (err) {
      setError(extractApiError(err, text("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const detachPolicy = async (policyArn: string) => {
    if (needsS3AccountSelection || !rawEntityName) return;
    setBusy(policyArn);
    setError(null);
    setActionMessage(null);
    try {
      await detachPolicyFromEntity(contextIdForApi, rawEntityName, policyArn);
      await load(contextIdForApi, rawEntityName);
      setActionMessage(text("Policy detached"));
    } catch (err) {
      setError(extractApiError(err, text("Unexpected error")));
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = (policyArn: string) => {
    policyConfirmation.requestConfirmation({
      title: text("Detach managed policy?"),
      description: text("Remove this managed policy from the selected {entity}.", { entity: singularLabel }),
      confirmLabel: text("Detach policy"),
      details: [
        { label: singularLabel, value: decodedEntity },
        { label: text("Policy ARN"), value: policyArn, mono: true },
      ],
      impacts: [text("Permissions granted only by this policy will no longer apply to the {entity}.", { entity: singularLabel })],
      onConfirm: () => detachPolicy(policyArn),
    });
  };

  const loadInlinePolicies = useCallback(async () => {
    if (!rawEntityName || needsS3AccountSelection) return [];
    return listInlinePoliciesForEntity(contextIdForApi, rawEntityName);
  }, [contextIdForApi, listInlinePoliciesForEntity, needsS3AccountSelection, rawEntityName]);

  const saveInlinePolicy = async (name: string, document: Record<string, unknown>) => {
    if (!rawEntityName) return;
    await putInlinePolicyForEntity(contextIdForApi, rawEntityName, name, document);
  };

  const removeInlinePolicy = async (name: string) => {
    if (!rawEntityName) return;
    await deleteInlinePolicyForEntity(contextIdForApi, rawEntityName, name);
  };

  if (isS3User) {
    if (embedded) {
      return (
        <PageBanner tone="info">
          {text("IAM {entities} are not available for standalone S3 users. Select an S3 Account to continue.", { entities: pluralLabel })}
        </PageBanner>
      );
    }
    return (
      <PageShell actionPresentation="listing"
          title={text(config.title)}
          description={text("Attach/detach IAM policies for a specific {entity}.", { entity: singularLabel })}
          breadcrumbs={managerPageBreadcrumbs(text, parentPageId[entityType], { label: text("Policies") })}
      >
        <PageBanner tone="info">
          {text("IAM {entities} are not available for standalone S3 users. Select an S3 Account to continue.", { entities: pluralLabel })}
        </PageBanner>
      </PageShell>
    );
  }

  if (!rawEntityName) {
    return <div className="ui-body text-slate-600">{text("{entity} not specified.", { entity: singularLabel })}</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">{text("Select an account before managing {entities}.", { entities: pluralLabel })}</div>;
  }

  const options = available.map((policy) => ({ value: policy.arn, label: policy.name }));
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: attached.length });
  const attachedPolicyColumns: Array<DataTableColumn<IamPolicy>> = [
    {
      id: "policy",
      label: text("Policy"),
      primary: true,
      render: (policy) => policy.name,
    },
    {
      id: "arn",
      label: text("ARN"),
      cellClassName: "break-all font-mono text-[11px]",
      render: (policy) => policy.arn,
    },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (policy) => (
        <ListActionButton variant="danger"
          type="button"
          onClick={() => handleDetach(policy.arn)}
          disabled={busy === policy.arn}
        >
          {text(busy === policy.arn ? "Detaching..." : "Detach")}
        </ListActionButton>
      ),
    },
  ];

  const detailLine =
    entityType === "role"
      ? (
        <>
          {text("Attach/detach policies for role")} <span className="font-semibold text-slate-700 dark:text-slate-100 [overflow-wrap:anywhere]">{decodedEntity}</span>.
        </>
      )
      : (
        <>
          {text("Attach/detach policies for")} <span className="font-semibold text-slate-700 dark:text-slate-100 [overflow-wrap:anywhere]">{decodedEntity}</span>.
        </>
      );

  const content = <>
      {embedded && (
        <div className="flex justify-end">
          <ListActionButton type="button" onClick={handleRefresh} disabled={loading}>
            {text("Refresh")}
          </ListActionButton>
        </div>
      )}
      {error && <PageBanner tone="error">{text(error)}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {noPoliciesAvailable && (
        <PageBanner tone="warning">{text("No IAM policies available. Create one before attaching to this {entity}.", { entity: singularLabel })}</PageBanner>
      )}

      <div className="settings-compact settings-stack">
        <InlinePolicyEditor
          entityType={entityType}
          namingValidationProfile={namingValidationProfile}
          entityLabel={singularLabel}
          entityName={decodedEntity}
          loadPolicies={loadInlinePolicies}
          savePolicy={saveInlinePolicy}
          deletePolicy={removeInlinePolicy}
          disabled={needsS3AccountSelection}
          disabledReason={text("Select an account before editing {entity} inline policies.", { entity: singularLabel })}
          key={`${config.singularLabel}-inline-${contextIdForApi ?? "none"}-${rawEntityName ?? ""}`}
        />

        <SettingsSection presentation="compact" title={text("Attached policies")} description={text("Attach/detach managed policies for this {entity}.", { entity: singularLabel })}>
          <div className="settings-stack">
            <form aria-label={text("Attach managed policy")} onSubmit={handleAttach} className="settings-fields">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <UiSelect label={text("Managed policy")} value={selectedArn} onChange={(event) => setSelectedArn(event.target.value)}
                    disabled={busy !== null || loading}>
                    <option value="">{text("Select a policy to attach")}</option>
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </UiSelect>
                </div>
                <SettingsButton type="submit" disabled={busy !== null || loading || !selectedArn}>
                  {text(busy === "attach" ? "Attaching..." : "Attach")}
                </SettingsButton>
              </div>
              <p className="settings-description">{text("Policies must be created first in the Policies tab.")}</p>
            </form>
            <DataTableShell
              columns={attachedPolicyColumns}
              rows={attached}
              rowKey={(policy) => policy.arn}
              status={tableStatus}
              loadingMessage={text("Loading policies...")}
              errorMessage={text("Unable to load policies.")}
              emptyMessage={text("No attached policies.")}
              tableClassName="ui-data-table"
              responsiveCards
            />
          </div>
        </SettingsSection>
      </div>
      {policyConfirmation.confirmationDialog}
    </>;

  if (embedded) return <div className="space-y-4">{content}</div>;

  return (
    <PageShell actionPresentation="listing"
      title={text(config.title)}
      description={detailLine}
      breadcrumbs={managerPageBreadcrumbs(
        text,
        parentPageId[entityType],
        { label: decodedEntity },
        { label: text("Policies") },
      )}
      actions={[
        { label: text("← Back to {entities}", { entities: pluralLabel }), to: config.managerRoute, variant: "ghost" },
        ...(extraActions?.(decodedEntity) ?? []),
        { label: text("Refresh"), onClick: handleRefresh, variant: "ghost" },
      ]}
    >

      {content}
    </PageShell>
  );
}
