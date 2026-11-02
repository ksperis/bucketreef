/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { IamPolicy, listIamPoliciesPage } from "../../api/managerIamPolicies";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { decodeRouteValue } from "../../utils/routeValues";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import InlinePolicyEditor from "./InlinePolicyEditor";
import ManagerIamAssociationPicker, {
  type ManagerIamAssociationFailure,
  type ManagerIamAssociationPickerItem,
} from "./ManagerIamAssociationPicker";
import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";

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
  listPoliciesForEntity: (contextId: S3ExecutionContextSelector, entityName: string) => Promise<IamPolicy[]>;
  attachPolicyToEntity: (contextId: S3ExecutionContextSelector, entityName: string, policy: IamPolicy) => Promise<IamPolicy>;
  detachPolicyFromEntity: (contextId: S3ExecutionContextSelector, entityName: string, policyArn: string) => Promise<void>;
  listInlinePoliciesForEntity: (contextId: S3ExecutionContextSelector, entityName: string) => Promise<{ name: string; document: Record<string, unknown> }[]>;
  putInlinePolicyForEntity: (
    contextId: S3ExecutionContextSelector,
    entityName: string,
    policyName: string,
    document: Record<string, unknown>
  ) => Promise<{ name: string; document: Record<string, unknown> }>;
  deleteInlinePolicyForEntity: (contextId: S3ExecutionContextSelector, entityName: string, policyName: string) => Promise<void>;
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
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode, namingValidationProfile } = useExecutionContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";

  const [attached, setAttached] = useState<IamPolicy[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPolicies, setSelectedPolicies] = useState<IamPolicy[]>([]);
  const [associationFailures, setAssociationFailures] = useState<ManagerIamAssociationFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const policyConfirmation = useConfirmActionDialog();
  const availablePolicies = useManagerIamCursorCollection(listIamPoliciesPage);
  const { setItems: setAvailablePolicies } = availablePolicies;

  const decodedEntity = decodeRouteValue(rawEntityName);

  const load = useCallback(async (contextId: S3ExecutionContextSelector, entityName: string) => {
    setLoading(true);
    setError(null);
    try {
      const attachedPolicies = await listPoliciesForEntity(contextId, entityName);
      setAttached(attachedPolicies);
    } catch (err) {
      setError(extractApiError(err, text("Unexpected error")));
    } finally {
      setLoading(false);
    }
  }, [listPoliciesForEntity, text]);

  useEffect(() => {
    setPickerOpen(false);
    setSelectedPolicies([]);
    setAssociationFailures([]);
    if (isS3User) {
      setAttached([]);
      setAvailablePolicies([]);
      setLoading(false);
      return;
    }
    if (needsContextSelection) {
      setAttached([]);
      setAvailablePolicies([]);
      setLoading(false);
      return;
    }
    if (rawEntityName) {
      load(contextIdForApi, rawEntityName);
    }
  }, [accessMode, contextIdForApi, isS3User, load, needsContextSelection, rawEntityName, setAvailablePolicies]);

  const handleRefresh = () => {
    if (needsContextSelection || !rawEntityName) return;
    load(contextIdForApi, rawEntityName);
  };

  const availablePolicyItems = useMemo(
    () => availablePolicies.items.filter((policy) => !attached.some((candidate) => candidate.arn === policy.arn)),
    [attached, availablePolicies.items],
  );

  const openPicker = () => {
    setSelectedPolicies([]);
    setAssociationFailures([]);
    setActionMessage(null);
    setPickerOpen(true);
    availablePolicies.load(contextIdForApi);
  };

  const closePicker = () => {
    if (busy === "attach") return;
    setPickerOpen(false);
    setSelectedPolicies([]);
    setAssociationFailures([]);
  };

  const togglePolicy = (item: ManagerIamAssociationPickerItem, checked: boolean) => {
    if (checked) {
      const policy = availablePolicyItems.find((candidate) => candidate.arn === item.id);
      if (policy) setSelectedPolicies((current) => [...current.filter((candidate) => candidate.arn !== policy.arn), policy]);
      return;
    }
    setSelectedPolicies((current) => current.filter((policy) => policy.arn !== item.id));
  };

  const handleAttach = async () => {
    if (needsContextSelection || !rawEntityName || selectedPolicies.length === 0 || busy !== null || loading) return;
    setBusy("attach");
    setError(null);
    setActionMessage(null);
    setAssociationFailures([]);
    const results = await Promise.all(selectedPolicies.map(async (policy) => {
      try {
        await attachPolicyToEntity(contextIdForApi, rawEntityName, policy);
        return { policy, error: null };
      } catch (err) {
        return { policy, error: extractApiError(err, text("Unexpected error")) };
      }
    }));
    const failures = results.filter((result) => result.error !== null);
    await load(contextIdForApi, rawEntityName);
    setBusy(null);
    if (failures.length === 0) {
      setPickerOpen(false);
      setSelectedPolicies([]);
      setActionMessage(text("Policies attached"));
      return;
    }
    setSelectedPolicies(failures.map((result) => result.policy));
    setAssociationFailures(failures.map((result) => ({
      id: result.policy.arn,
      label: result.policy.name,
      message: result.error ?? text("Unexpected error"),
    })));
  };

  const detachPolicy = async (policyArn: string) => {
    if (needsContextSelection || !rawEntityName) return;
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
    if (!rawEntityName || needsContextSelection) return [];
    return listInlinePoliciesForEntity(contextIdForApi, rawEntityName);
  }, [contextIdForApi, listInlinePoliciesForEntity, needsContextSelection, rawEntityName]);

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

  if (needsContextSelection) {
    return <div className="ui-body text-slate-600">{text("Select a context before managing {entities}.", { entities: pluralLabel })}</div>;
  }

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
      <div className="settings-compact settings-stack">
        <InlinePolicyEditor
          entityType={entityType}
          namingValidationProfile={namingValidationProfile}
          entityLabel={singularLabel}
          entityName={decodedEntity}
          loadPolicies={loadInlinePolicies}
          savePolicy={saveInlinePolicy}
          deletePolicy={removeInlinePolicy}
          disabled={needsContextSelection}
          disabledReason={text("Select a context before editing {entity} inline policies.", { entity: singularLabel })}
          key={`${config.singularLabel}-inline-${contextIdForApi ?? "none"}-${rawEntityName ?? ""}`}
        />

        <SettingsSection
          presentation="compact"
          title={text("Managed policies")}
          description={`${text("Attach/detach managed policies for this {entity}.", { entity: singularLabel })} ${text("Associated: {count}", { count: attached.length })}`}
        >
          <div className="settings-stack">
            <div className="flex justify-end">
              <ListActionButton type="button" onClick={openPicker} disabled={pickerOpen || busy !== null || loading}>
                {text("Attach policies")}
              </ListActionButton>
            </div>
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
            {pickerOpen ? (
              <ManagerIamAssociationPicker
                title={text("Attach policies")}
                searchLabel={text("Search policies")}
                searchPlaceholder={text("Search policies by name or ARN")}
                emptyMessage={availablePolicies.search.trim()
                  ? text("No matching policies.")
                  : text("No IAM policies available to attach to this {entity}.", { entity: singularLabel })}
                items={availablePolicyItems.map((policy) => ({ id: policy.arn, label: policy.name, secondary: policy.arn }))}
                selectedIds={selectedPolicies.map((policy) => policy.arn)}
                search={availablePolicies.search}
                loading={availablePolicies.loading}
                error={availablePolicies.error}
                failures={associationFailures}
                page={availablePolicies.page}
                pageSize={availablePolicies.pageSize}
                canPrevious={availablePolicies.canPrevious}
                canNext={availablePolicies.canNext}
                submitting={busy === "attach"}
                submitLabel={text("Attach")}
                onSearchChange={availablePolicies.setSearch}
                onToggle={togglePolicy}
                onPreviousPage={availablePolicies.previousPage}
                onNextPage={availablePolicies.nextPage}
                onCancel={closePicker}
                onSubmit={() => void handleAttach()}
              />
            ) : null}
            <p className="settings-description">{text("Policies must be created first in the Policies tab.")}</p>
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
