/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import {
  SettingsButton,
  SettingsInput,
} from "../../../components/settings/SettingsControls";
import { SettingsChoiceRow } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiTextarea from "../../../components/ui/UiTextarea";
import { cx, uiCardMutedClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import {
  commonNotificationEvents,
  isNotificationTopicVisuallyEditable,
  notificationTopicArn,
  notificationTopicEventsLabel,
  notificationTopicFilterLabel,
  notificationTopicId,
  readNotificationVisualTopic,
  type NotificationTopicRecord,
  type NotificationVisualTopicPatch,
} from "./notificationEditorModel";
import type { useBucketNotificationsController } from "./useBucketNotificationsController";

type BucketNotificationsController = ReturnType<typeof useBucketNotificationsController>;

type BucketNotificationsFeatureProps = {
  controller: BucketNotificationsController;
  exampleAccountId: string;
};

type NotificationSummaryRow = {
  key: string;
  topic: NotificationTopicRecord;
};

function buildNotificationExample(accountId: string) {
  return `{
  "TopicConfigurations": [
    {
      "Id": "ObjectCreateAll",
      "TopicArn": "arn:aws:sns:default:${accountId}:example-topic",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            { "Name": "prefix", "Value": "uploads/" },
            { "Name": "suffix", "Value": ".json" }
          ]
        }
      }
    }
  ]
}`;
}

const commonEventValues = new Set<string>(commonNotificationEvents.map((event) => event.value));

function parseCustomEvents(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function NotificationTopicEditor({
  index,
  topic,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  topic: NotificationTopicRecord;
  disabled: boolean;
  onChange: (patch: NotificationVisualTopicPatch) => void;
  onRemove: () => void;
}) {
  const editable = isNotificationTopicVisuallyEditable(topic);
  const draft = readNotificationVisualTopic(topic);
  const topicLabel = notificationTopicId(topic) ?? `Topic notification ${index + 1}`;

  if (!editable) {
    return (
      <div
        className={cx(uiCardMutedClass, "space-y-2 px-3 py-3")}
        data-testid="notifications-advanced-topic"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="settings-label break-all">{topicLabel}</p>
            <p className="settings-description break-all">
              {notificationTopicArn(topic) ?? "No TopicArn"}
            </p>
            <p className="settings-description">
              {notificationTopicEventsLabel(topic)} · {notificationTopicFilterLabel(topic)}
            </p>
          </div>
          <UiBadge tone="warning">Advanced notification — edit in JSON</UiBadge>
        </div>
      </div>
    );
  }

  const customEvents = draft.events.filter((event) => !commonEventValues.has(event));
  const toggleCommonEvent = (eventName: string, checked: boolean) => {
    const selectedCommonEvents = commonNotificationEvents
      .map((event) => event.value)
      .filter((event) => (event === eventName ? checked : draft.events.includes(event)));
    onChange({ events: [...selectedCommonEvents, ...customEvents] });
  };

  return (
    <div
      className={cx(uiCardMutedClass, "space-y-4 px-3 py-3")}
      data-testid="notifications-visual-topic"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="settings-label">Topic notification {index + 1}</p>
          <p className="settings-description">
            Changes stay local until the whole notification configuration is saved.
          </p>
        </div>
        <SettingsButton type="button" variant="danger" onClick={onRemove} disabled={disabled}>
          Remove notification
        </SettingsButton>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsInput
          label="ID (optional)"
          value={draft.id}
          onChange={(event) => onChange({ id: event.target.value })}
          disabled={disabled}
        />
        <SettingsInput
          label="Topic ARN"
          value={draft.topicArn}
          placeholder="arn:aws:sns:default:account:topic"
          onChange={(event) => onChange({ topicArn: event.target.value })}
          disabled={disabled}
          required
        />
      </div>

      <div className="space-y-3 rounded-md border border-[color:var(--ui-border-soft)] p-3">
        <div>
          <p className="settings-label">Events</p>
          <p className="settings-description">
            Select common S3 event families and keep any more specific event names below.
          </p>
        </div>
        <div className="grid gap-x-4 md:grid-cols-2">
          {commonNotificationEvents.map((event) => (
            <SettingsChoiceRow
              key={event.value}
              title={event.label}
              description={event.value}
              ariaLabel={event.label}
              checked={draft.events.includes(event.value)}
              disabled={disabled}
              onChange={(checked) => toggleCommonEvent(event.value, checked)}
            />
          ))}
        </div>
        <UiTextarea
          label="Other S3 events"
          rows={3}
          value={customEvents.join("\n")}
          placeholder="s3:ObjectCreated:Put"
          onChange={(event) => {
            const selectedCommonEvents = commonNotificationEvents
              .map((entry) => entry.value)
              .filter((entry) => draft.events.includes(entry));
            onChange({
              events: [...selectedCommonEvents, ...parseCustomEvents(event.target.value)],
            });
          }}
          className="settings-control font-mono"
          spellCheck={false}
          disabled={disabled}
        />
      </div>

      <div className="space-y-3 rounded-md border border-[color:var(--ui-border-soft)] p-3">
        <div>
          <p className="settings-label">Object key filter</p>
          <p className="settings-description">
            Prefix and suffix map to S3 Filter.Key.FilterRules.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsInput
            label="Prefix"
            value={draft.prefix}
            placeholder="uploads/"
            onChange={(event) => onChange({ prefix: event.target.value })}
            disabled={disabled}
          />
          <SettingsInput
            label="Suffix"
            value={draft.suffix}
            placeholder=".json"
            onChange={(event) => onChange({ suffix: event.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export default function BucketNotificationsFeature({
  controller,
  exampleAccountId,
}: BucketNotificationsFeatureProps) {
  const [showJsonExample, setShowJsonExample] = useState(false);
  const {
    addDraftTopic,
    closeEditor,
    configured,
    draftConfiguration,
    draftSignature,
    draftTopics,
    dirty,
    editorError,
    editorMode,
    editorOpen,
    error,
    hasAdvancedConfiguration,
    hasAdvancedDraftTopLevel,
    jsonText,
    loading,
    openEditor,
    removeDraftTopic,
    saveDraft,
    saving,
    status,
    topicCount,
    topics,
    updateDraftTopic,
    updateEditorMode,
    updateJsonText,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: false,
  });
  const summaryRows = useMemo<NotificationSummaryRow[]>(
    () =>
      topics.map((topic, index) => ({
        key: `${notificationTopicId(topic) ?? notificationTopicArn(topic) ?? "topic"}-${index}`,
        topic,
      })),
    [topics],
  );
  const summaryColumns: Array<DataTableColumn<NotificationSummaryRow>> = [
    {
      id: "id",
      label: "ID",
      primary: true,
      headerClassName: "min-w-44",
      cellClassName: "min-w-44",
      render: ({ topic }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all">{notificationTopicId(topic) ?? "(no ID)"}</span>
          {!isNotificationTopicVisuallyEditable(topic) ? (
            <UiBadge tone="warning">Advanced</UiBadge>
          ) : null}
        </div>
      ),
    },
    {
      id: "topic",
      label: "Topic",
      headerClassName: "min-w-64",
      cellClassName: "min-w-64",
      render: ({ topic }) => (
        <code className="break-all ui-caption">{notificationTopicArn(topic) ?? "(missing TopicArn)"}</code>
      ),
    },
    {
      id: "events",
      label: "Events",
      headerClassName: "min-w-56",
      cellClassName: "min-w-56",
      render: ({ topic }) => notificationTopicEventsLabel(topic),
    },
    {
      id: "filter",
      label: "Filter",
      headerClassName: "min-w-44",
      cellClassName: "min-w-44",
      render: ({ topic }) => notificationTopicFilterLabel(topic),
    },
  ];
  const canAddTopic =
    draftConfiguration.TopicConfigurations === undefined ||
    Array.isArray(draftConfiguration.TopicConfigurations);

  const visualEditor = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <p className="settings-description">
            Topic notifications supported by BucketReef can be edited here. Advanced S3 notification structures remain untouched and are edited in JSON.
          </p>
        </div>
        <SettingsButton
          type="button"
          variant="secondary"
          onClick={addDraftTopic}
          disabled={saving || !canAddTopic}
        >
          Add topic notification
        </SettingsButton>
      </div>

      {hasAdvancedDraftTopLevel ? (
        <UiInlineMessage tone="warning">
          Additional notification types or top-level fields are preserved. Edit those fields in JSON.
        </UiInlineMessage>
      ) : null}

      {draftTopics.length === 0 ? (
        <div className={cx(uiCardMutedClass, "px-3 py-4 text-center settings-description")}>
          No topic notifications. Add one here or use JSON for advanced notification types.
        </div>
      ) : (
        draftTopics.map((topic, index) => (
          <NotificationTopicEditor
            key={`${notificationTopicId(topic) ?? notificationTopicArn(topic) ?? "topic"}-${index}`}
            index={index}
            topic={topic}
            disabled={saving}
            onChange={(patch) => updateDraftTopic(index, patch)}
            onRemove={() => removeDraftTopic(index)}
          />
        ))
      )}
    </div>
  );

  const example = buildNotificationExample(exampleAccountId);
  const jsonEditor = (
    <div className="space-y-3">
      <p className="settings-description">
        Edit the complete S3 notification configuration object. Switching back to Visual validates the JSON first.
      </p>
      <UiTextarea
        label="Notification configuration (JSON)"
        rows={20}
        value={jsonText}
        onChange={(event) => updateJsonText(event.target.value)}
        className="settings-control font-mono"
        spellCheck={false}
        disabled={saving}
      />
      <BucketFeatureJsonExample
        show={showJsonExample}
        onToggle={() => setShowJsonExample((current) => !current)}
        example={example}
        onUseExample={() => updateJsonText(example)}
        disabled={saving}
        helperText={
          <span className="settings-description">
            Need a topic? Create it in the Topics section, then use its TopicArn here.
          </span>
        }
      />
    </div>
  );

  return (
    <>
      <BucketFeatureSummarySection
        title="Notifications / SNS topics"
        description="Configure S3 events delivered to SNS topics."
        visualState={visualState}
        metadata={topicCount === 1 ? "1 topic notification" : `${topicCount} topic notifications`}
        loading={loading}
        error={error}
        successMessage={status}
        editDisabled={notImplemented || saving}
        onEdit={openEditor}
        testId="bucket-feature-notifications"
      >
        <div className="space-y-3">
          {hasAdvancedConfiguration ? (
            <UiInlineMessage tone="warning">
              Advanced notification fields are preserved and can be edited in JSON.
            </UiInlineMessage>
          ) : null}
          <DataTableShell
            columns={summaryColumns}
            rows={summaryRows}
            rowKey={(row) => row.key}
            status={summaryRows.length === 0 ? "empty" : "ready"}
            loadingMessage="Loading topic notifications..."
            errorMessage="Unable to load topic notifications."
            emptyMessage={
              configured
                ? "No topic notifications. The bucket has advanced notification configuration."
                : "No notifications configured on this bucket."
            }
            primaryColumnId="id"
            responsiveCards
          />
        </div>
      </BucketFeatureSummarySection>

      {editorOpen ? (
        <BucketFeatureEditorDialog
          title="Edit bucket notifications"
          mode={editorMode}
          onModeChange={updateEditorMode}
          draftKey={draftSignature}
          dirty={dirty}
          busy={saving}
          error={editorError}
          visualContent={visualEditor}
          jsonContent={jsonEditor}
          onSave={saveDraft}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}
