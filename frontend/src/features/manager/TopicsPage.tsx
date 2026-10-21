/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listTopics, type Topic } from "../../api/topics";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import UiInput from "../../components/ui/UiInput";
import { ListActions, ListActionButton, ListActionLink } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { dataTableDefaultActionProps, type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import TopicCreateDialog from "./TopicCreateDialog";
import TopicDeleteDialog from "./TopicDeleteDialog";
import { useManagerI18n } from "./managerI18n";

type TopicAction = { kind: "create"; accountId: S3ExecutionContextSelector }
  | { kind: "delete"; accountId: S3ExecutionContextSelector; topic: Topic };

export default function TopicsPage() {
  const { text } = useManagerI18n();
  const { contexts, contextIdForApi, requiresContextSelection, accessMode } = useExecutionContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const selectedS3Account = contexts.find(account => account.id === contextIdForApi);
  const snsFeatureEnabled = selectedS3Account?.storage_endpoint_capabilities?.sns !== false;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [active, setActive] = useState<TopicAction | null>(null);
  const requestSequence = useRef(0);
  const currentAccount = useRef(contextIdForApi);
  currentAccount.current = contextIdForApi;
  const fetchTopics = useCallback(async (accountId: S3ExecutionContextSelector) => {
    const request = ++requestSequence.current;
    setLoading(true); setError(null);
    try {
      const data = await listTopics(accountId);
      if (request === requestSequence.current) setTopics(data);
    } catch (error) {
      if (request === requestSequence.current) { setTopics([]); setError(extractApiError(error, text("Unable to load topics."))); }
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [text]);
  useEffect(() => {
    setActionMessage(null);
    if (needsContextSelection) { setTopics([]); setLoading(false); }
    else void fetchTopics(contextIdForApi);
    return () => { requestSequence.current += 1; };
  }, [contextIdForApi, needsContextSelection, accessMode, fetchTopics]);
  const close = () => setActive(null);
  const refreshAfterMutation = (accountId: S3ExecutionContextSelector, message: string) => {
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
      label: text("Topic"),
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
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (topic) => (
        <ListActions>
          <ListActionLink
            to={`/manager/topics/${encodeURIComponent(topic.name)}`}
            {...dataTableDefaultActionProps}
          >
            {text("Edit")}
          </ListActionLink>
          <ListActionButton
            type="button"
            variant="danger"
            onClick={() => setActive({ kind: "delete", accountId: contextIdForApi, topic })}
          >
            {text("Delete")}
          </ListActionButton>
        </ListActions>
      ),
    },
  ];

  return <div className="space-y-4">
      <PageHeader actionPresentation="listing"
        title={text("SNS Topics")}
        description={text("List, create, and secure account-owned SNS topics.")}
        breadcrumbs={managerPageBreadcrumbs(text, "topics")}
        actions={
          !needsContextSelection && snsFeatureEnabled
            ? [
                {
                  label: text("Create topic"),
                  onClick: () => setActive({ kind: "create", accountId: contextIdForApi }),
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
            {text("Dismiss")}
          </button>
        </PageBanner>
      )}

      {error && <PageBanner tone="error">{text(error)}</PageBanner>}

      {needsContextSelection ? (
        <PageEmptyState
          title={text("Select an account before managing SNS topics")}
          description={text("SNS topics are created within an execution context. Choose an account to list topics and update notification settings.")}
          primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
          tone="warning"
        />
      ) : !snsFeatureEnabled ? (
        <PageEmptyState
          title={text("SNS topics are disabled for this endpoint")}
          description={text("Enable the SNS capability on the selected storage endpoint before creating or managing topic-based bucket notifications.")}
          primaryAction={{ label: text("Open buckets"), to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
            title={text("Topics")}
            countLabel={text(filteredTopics.length === 1 ? "{count} result" : "{count} results", { count: filteredTopics.length })}
            search={
              <UiInput aria-label={text("Search")} size="compact"
                type="search"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder={text("Search by topic or ARN")}
              />
            }
        >
          <DataTableShell
            columns={topicColumns}
            rows={filteredTopics}
            rowKey={(topic) => topic.arn}
            status={filteredTableStatus}
            loadingMessage={text("Loading topics...")}
            errorMessage={text("Unable to load topics.")}
            emptyMessage={text("No topics.")}
            tableClassName="ui-data-table"
            responsiveCards
          />
        </ListPageSection>
      )}

    {active?.kind === "create" && <TopicCreateDialog accountId={active.accountId} currentAccountId={contextIdForApi}
      onClose={close} onCreated={name => refreshAfterMutation(active.accountId, text("Topic '{name}' created.", { name }))} />}
    {active?.kind === "delete" && <TopicDeleteDialog accountId={active.accountId} currentAccountId={contextIdForApi}
      topic={active.topic} onClose={close}
      onDeleted={() => refreshAfterMutation(active.accountId, text("Topic '{name}' deleted.", { name: active.topic.name }))} />}
  </div>;
}
