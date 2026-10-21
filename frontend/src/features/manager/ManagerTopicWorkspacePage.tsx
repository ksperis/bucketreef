/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { listTopics, type Topic } from "../../api/topics";
import PageEmptyState from "../../components/PageEmptyState";
import PageBanner from "../../components/PageBanner";
import { extractApiError } from "../../utils/apiError";
import ManagerResourceWorkspace from "./ManagerResourceWorkspace";
import TopicAttributesEditor from "./TopicAttributesEditor";
import TopicPolicyEditor from "./TopicPolicyEditor";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";
import { useS3AccountContext } from "./S3AccountContext";

type TopicTab = "configuration" | "policy";

export default function ManagerTopicWorkspacePage() {
  const { text } = useManagerI18n();
  const { topicName } = useParams<{ topicName: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { accounts, contextIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsSelection = requiresS3AccountSelection && !contextIdForApi;
  const selectedS3Account = accounts.find(account => account.id === contextIdForApi);
  const snsFeatureEnabled = selectedS3Account?.storage_endpoint_capabilities?.sns !== false;
  const name = useMemo(() => {
    if (!topicName) return "";
    try { return decodeURIComponent(topicName); } catch { return topicName; }
  }, [topicName]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name || needsSelection || !snsFeatureEnabled) {
      setTopic(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listTopics(contextIdForApi)
      .then((topics) => {
        if (cancelled) return;
        setTopic(topics.find((candidate) => candidate.name === name) ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err, text("Unable to load topics.")));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessMode, contextIdForApi, name, needsSelection, snsFeatureEnabled, text]);

  if (needsSelection) {
    return (
      <PageEmptyState
        title={text("Select an account before managing SNS topics")}
        description={text("SNS topics are created within an execution context. Choose an account to manage this topic.")}
        primaryAction={{ label: text("Open dashboard"), to: "/manager" }}
        tone="warning"
      />
    );
  }
  if (!snsFeatureEnabled) {
    return (
      <PageEmptyState
        title={text("SNS topics are disabled for this endpoint")}
        description={text("Enable the SNS capability on the selected storage endpoint before managing topic-based bucket notifications.")}
        primaryAction={{ label: text("Back to topics"), to: "/manager/topics" }}
        tone="warning"
      />
    );
  }
  if (loading) return <PageBanner tone="info">{text("Loading topics...")}</PageBanner>;
  if (error) return <PageBanner tone="error">{text(error)}</PageBanner>;
  if (!topic) {
    return (
      <PageEmptyState
        title={text("SNS topic not found")}
        description={text("The selected topic is no longer available in this execution context.")}
        primaryAction={{ label: text("Back to topics"), to: "/manager/topics" }}
        tone="warning"
      />
    );
  }

  const baseRoute = `/manager/topics/${encodeURIComponent(topic.name)}`;
  const activeTab: TopicTab = location.pathname.endsWith("/policy") ? "policy" : "configuration";
  const tabs = [
    { id: "configuration" as const, label: text("Configuration"), to: baseRoute },
    { id: "policy" as const, label: text("Policy"), to: `${baseRoute}/policy` },
  ];

  return (
    <ManagerResourceWorkspace
      title={text("SNS topic: {name}", { name: topic.name })}
      description={text("Manage topic delivery configuration and access policy from one workspace.")}
      breadcrumbs={managerPageBreadcrumbs(text, "topics", { label: topic.name })}
      backLabel={text("← Back to topics")}
      backTo="/manager/topics"
      tabs={tabs}
      activeTab={activeTab}
    >
      {activeTab === "configuration" && (
        <TopicAttributesEditor
          embedded
          accountId={contextIdForApi}
          currentAccountId={contextIdForApi}
          topic={topic}
          onClose={() => navigate("/manager/topics")}
          onSaved={(configuration) => setTopic((current) => current ? { ...current, configuration } : current)}
        />
      )}
      {activeTab === "policy" && (
        <TopicPolicyEditor
          embedded
          accountId={contextIdForApi}
          currentAccountId={contextIdForApi}
          topic={topic}
          onClose={() => navigate("/manager/topics")}
        />
      )}
    </ManagerResourceWorkspace>
  );
}
