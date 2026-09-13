/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useId, useState } from "react";
import { getTopicPolicy, updateTopicPolicy, type Topic } from "../../api/topics";
import type { S3AccountSelector } from "../../api/accountParams";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiTextarea from "../../components/ui/UiTextarea";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { extractApiError } from "../../utils/apiError";
import { useSettingsRemoteDraft } from "../../components/settings/useSettingsRemoteDraft";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

const defaultPolicy = JSON.stringify({ Version: "2012-10-17", Statement: [] }, null, 2);

export default function TopicPolicyEditor({ accountId, currentAccountId, topic, onClose }: {
  accountId: S3AccountSelector;
  currentAccountId: S3AccountSelector;
  topic: Topic;
  onClose: () => void;
}) {
  const exampleId = useId();
  const load = useCallback(async () => {
    const { policy } = await getTopicPolicy(accountId, topic.arn);
    return policy && Object.keys(policy).length ? JSON.stringify(policy, null, 2) : defaultPolicy;
  }, [accountId, topic.arn]);
  const { draft, setDraft, setBaseline, dirty, loading, loadError, retry } = useSettingsRemoteDraft(() => defaultPolicy, load, "Unable to load topic settings.");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showExample, setShowExample] = useState(false);
  const fieldsDisabled = loading || saving || Boolean(loadError);
  useEffect(() => {
    if (currentAccountId !== accountId && !dirty && !saving) onClose();
  }, [accountId, currentAccountId, dirty, onClose, saving]);
  const update = (value: string) => {
    setDraft(value); setValidationError(null); setStatus(null); setError(null);
  };
  const example = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "AllowBucketNotifications", Effect: "Allow", Principal: "*", Action: "sns:Publish",
      Resource: topic.arn,
      Condition: { ArnLike: { "aws:SourceArn": "arn:aws:s3:::example-bucket" } },
    }],
  }, null, 2);
  const save = async () => {
    if (fieldsDisabled) return;
    setError(null); setStatus(null);
    let parsed: unknown;
    try { parsed = draft.trim() ? JSON.parse(draft) : {}; }
    catch { setValidationError("Policy must be valid JSON."); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setValidationError("Policy must be a JSON object."); return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      await updateTopicPolicy(accountId, topic.arn, parsed as Record<string, unknown>);
      setBaseline(draft);
      setStatus("Policy updated.");
    } catch (error) { setError(extractApiError(error, "Unable to update topic policy.")); }
    finally { setSaving(false); }
  };
  return <SettingsWorkflowForm title={`Topic policy · ${topic.name}`}
    description="Edit the SNS policy that controls access to this topic."
    breadcrumbs={managerPageBreadcrumbs("topics", { label: "Policy" })} backLabel="Back to topics"
    dirty={dirty && !loading && !loadError} busy={saving} loading={loading} disabled={Boolean(loadError)}
    error={loadError || error} submitLabel="Save policy" onSubmit={save} onClose={onClose}>
    {loading && <p role="status" className="settings-description">Loading topic policy...</p>}
    {loadError && <div><SettingsButton variant="secondary" onClick={retry}>Retry loading</SettingsButton></div>}
    {status && <UiInlineMessage tone="success" role="status">{status}</UiInlineMessage>}
    <UiTextarea label="Policy JSON" value={draft} onChange={event => update(event.target.value)}
      error={validationError} className="font-mono" rows={16} placeholder={defaultPolicy}
      spellCheck={false} disabled={fieldsDisabled} />
    <SettingsSection title="Policy example" presentation="compact">
      <div className="settings-stack">
        <div className="flex flex-wrap items-center gap-2">
          <SettingsButton variant="secondary" aria-expanded={showExample} aria-controls={exampleId}
            onClick={() => setShowExample(value => !value)}>{showExample ? "Hide example" : "Show example"}</SettingsButton>
          <SettingsButton variant="secondary" disabled={fieldsDisabled}
            onClick={() => { update(example); setShowExample(true); }}>Use example</SettingsButton>
        </div>
        <pre id={exampleId} hidden={!showExample}
          className="min-w-0 whitespace-pre-wrap break-all rounded-md border border-[var(--ui-border-soft)] bg-[var(--ui-surface-muted)] p-3 font-mono ui-caption text-[var(--ui-text)]">{example}</pre>
      </div>
    </SettingsSection>
  </SettingsWorkflowForm>;
}
