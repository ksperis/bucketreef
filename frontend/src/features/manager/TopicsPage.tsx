/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listTopics, type Topic } from "../../api/topics";
import type { S3AccountSelector } from "../../api/accountParams";
import UiInput from "../../components/ui/UiInput";
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import TopicCreateDialog from "./TopicCreateDialog";
import TopicDeleteDialog from "./TopicDeleteDialog";
import TopicAttributesEditor from "./TopicAttributesEditor";
import TopicPolicyEditor from "./TopicPolicyEditor";

type TopicAction = { kind: "create"; accountId: S3AccountSelector }
  | { kind: "attributes" | "policy" | "delete"; accountId: S3AccountSelector; topic: Topic };

export default function TopicsPage() {
  const { accounts, selectedS3AccountId, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const selectedS3Account = accounts.find(account => String(account.id) === String(accountIdForApi ?? selectedS3AccountId));
  const snsFeatureEnabled = selectedS3Account?.storage_endpoint_capabilities?.sns !== false;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [active, setActive] = useState<TopicAction | null>(null);
  const requestSequence = useRef(0);
  const currentAccount = useRef(accountIdForApi);
  currentAccount.current = accountIdForApi;
  const fetchTopics = useCallback(async (accountId: S3AccountSelector) => {
    const request = ++requestSequence.current;
    setLoading(true); setError(null);
    try {
      const data = await listTopics(accountId);
      if (request === requestSequence.current) setTopics(data);
    } catch (error) {
      if (request === requestSequence.current) { setTopics([]); setError(extractApiError(error, "Unable to load topics.")); }
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setActionMessage(null);
    if (needsS3AccountSelection) { setTopics([]); setLoading(false); }
    else void fetchTopics(accountIdForApi ?? null);
    return () => { requestSequence.current += 1; };
  }, [accountIdForApi, needsS3AccountSelection, accessMode, fetchTopics]);
  const close = () => setActive(null);
  const refreshAfterMutation = (accountId: S3AccountSelector, message: string) => {
    setActive(null);
    if (currentAccount.current !== accountId) return;
    setActionMessage(message);
    void fetchTopics(accountId);
  };
  const filteredTopics = useMemo(() => {
    const needle = topicFilter.trim().toLowerCase();
    return needle ? topics.filter(topic => topic.name.toLowerCase().includes(needle) || topic.arn.toLowerCase().includes(needle)) : topics;
  }, [topicFilter, topics]);
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
            onClick={() => setActive({ kind: "attributes", accountId: accountIdForApi, topic })}
          >
            Attributes
          </ListActionButton>
          <ListActionButton
            type="button"
            onClick={() => setActive({ kind: "policy", accountId: accountIdForApi, topic })}
          >
            Policy
          </ListActionButton>
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() => setActive({ kind: "delete", accountId: accountIdForApi, topic })}
          >
            Delete
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  if (active?.kind === "attributes") return <TopicAttributesEditor
    key={`${active.accountId}:${active.topic.arn}`} accountId={active.accountId} currentAccountId={accountIdForApi}
    topic={active.topic} onClose={close} onSaved={configuration => {
      if (currentAccount.current !== active.accountId) return;
      setTopics(current => current.map(topic => topic.arn === active.topic.arn ? { ...topic, configuration } : topic));
    }} />;
  if (active?.kind === "policy") return <TopicPolicyEditor
    key={`${active.accountId}:${active.topic.arn}`} accountId={active.accountId} currentAccountId={accountIdForApi}
    topic={active.topic} onClose={close} />;

  return <div className="space-y-4">
      <PageHeader actionPresentation="listing"
        title="SNS Topics"
        description="List, create, and secure account-owned SNS topics."
        breadcrumbs={managerPageBreadcrumbs("topics")}
        actions={
          !needsS3AccountSelection && snsFeatureEnabled
            ? [
                {
                  label: "Create topic",
                  onClick: () => setActive({ kind: "create", accountId: accountIdForApi }),
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

    {active?.kind === "create" && <TopicCreateDialog accountId={active.accountId} currentAccountId={accountIdForApi}
      onClose={close} onCreated={name => refreshAfterMutation(active.accountId, `Topic '${name}' created.`)} />}
    {active?.kind === "delete" && <TopicDeleteDialog accountId={active.accountId} currentAccountId={accountIdForApi}
      topic={active.topic} onClose={close}
      onDeleted={() => refreshAfterMutation(active.accountId, `Topic '${active.topic.name}' deleted.`)} />}
  </div>;
}
