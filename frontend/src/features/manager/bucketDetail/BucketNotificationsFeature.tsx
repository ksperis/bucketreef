/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import DataTableShell, { type DataTableColumn } from "../../../components/list/DataTableShell";
import {
  SettingsButton,
  SettingsInput,
} from "../../../components/settings/SettingsControls";
import {
  SettingsAutocomplete,
  SettingsMultiValueAutocomplete,
} from "../../../components/settings/SettingsAutocomplete";
import { SettingsChoiceRow } from "../../../components/settings/SettingsLayout";
import UiBadge from "../../../components/ui/UiBadge";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureEditorDialog from "./BucketFeatureEditorDialog";
import {
  BucketFeatureEditorEmpty,
  BucketFeatureEditorGroup,
  BucketFeatureEditorItem,
  BucketFeatureEditorList,
  BucketFeatureEditorToolbar,
  BucketFeatureJsonPane,
} from "./BucketFeatureEditorLayout";
import BucketFeatureSummarySection from "./BucketFeatureSummarySection";
import { useBucketFeatureSuggestions } from "./BucketFeatureSuggestions";
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
};

type NotificationSummaryRow = {
  index: number;
  key: string;
  topic: NotificationTopicRecord;
};

const commonEventValues = new Set<string>(commonNotificationEvents.map((event) => event.value));

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
  const { notificationEvents, prefixes, suffixes, topicArns } = useBucketFeatureSuggestions();

  if (!editable) {
    return (
      <BucketFeatureEditorItem testId="notifications-advanced-topic">
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
      </BucketFeatureEditorItem>
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
    <BucketFeatureEditorItem testId="notifications-visual-topic">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="settings-label">Topic notification {index + 1}</p>
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
        <SettingsAutocomplete
          label="Topic ARN"
          value={draft.topicArn}
          placeholder="arn:aws:sns:default:account:topic"
          onChange={(value) => onChange({ topicArn: value })}
          disabled={disabled}
          required
          {...topicArns}
        />
      </div>

      <BucketFeatureEditorGroup>
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
        <SettingsMultiValueAutocomplete
          label="Other S3 events"
          itemLabel="event"
          inputLabel="Add S3 event"
          values={customEvents}
          placeholder="s3:ObjectCreated:Put"
          onChange={(nextCustomEvents) => {
            const selectedCommonEvents = commonNotificationEvents
              .map((entry) => entry.value)
              .filter((entry) => draft.events.includes(entry));
            onChange({ events: [...selectedCommonEvents, ...nextCustomEvents] });
          }}
          description="Select a specific S3 event or enter any event name supported by the endpoint."
          emptyText="No specific events selected."
          disabled={disabled}
          {...notificationEvents}
        />
      </BucketFeatureEditorGroup>

      <BucketFeatureEditorGroup>
        <div>
          <p className="settings-label">Object key filter</p>
          <p className="settings-description">
            Prefix and suffix map to S3 Filter.Key.FilterRules.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsAutocomplete
            label="Prefix"
            value={draft.prefix}
            placeholder="uploads/"
            onChange={(value) => onChange({ prefix: value })}
            disabled={disabled}
            {...prefixes}
          />
          <SettingsAutocomplete
            label="Suffix"
            value={draft.suffix}
            placeholder=".json"
            onChange={(value) => onChange({ suffix: value })}
            disabled={disabled}
            {...suffixes}
          />
        </div>
      </BucketFeatureEditorGroup>
    </BucketFeatureEditorItem>
  );
}

export default function BucketNotificationsFeature({
  controller,
}: BucketNotificationsFeatureProps) {
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
    editorTargetIndex,
    error,
    hasAdvancedConfiguration,
    hasAdvancedDraftTopLevel,
    jsonText,
    loading,
    openEditorFor,
    openEditorWithNew,
    openJsonEditor,
    removeDraftTopic,
    removeTopicDirect,
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
        index,
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
    {
      id: "manage",
      label: "Manage",
      mobileRole: "actions",
      headerClassName: "w-px whitespace-nowrap text-right",
      cellClassName: "w-px whitespace-nowrap",
      render: ({ index }) => (
        <div className="bucket-feature-row-actions">
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={() => openEditorFor(index)}
            disabled={saving || notImplemented}
          >
            Edit
          </SettingsButton>
          <SettingsButton
            type="button"
            variant="danger"
            onClick={() => void removeTopicDirect(index)}
            disabled={saving || notImplemented}
          >
            Remove
          </SettingsButton>
        </div>
      ),
    },
  ];
  const canAddTopic =
    draftConfiguration.TopicConfigurations === undefined ||
    Array.isArray(draftConfiguration.TopicConfigurations);
  const visibleDraftTopics = draftTopics
    .map((topic, index) => ({ topic, index }))
    .filter(({ index }) => editorTargetIndex === null || index === editorTargetIndex);

  const visualEditor = (
    <div className="space-y-3">
      <BucketFeatureEditorToolbar
        action={
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={addDraftTopic}
            disabled={saving || !canAddTopic}
          >
            Add topic notification
          </SettingsButton>
        }
      >
        <div className="max-w-3xl">
          <p>
            Topic notifications supported by BucketReef can be edited here. Advanced S3 notification structures remain untouched and are edited in JSON.
          </p>
        </div>
      </BucketFeatureEditorToolbar>

      {hasAdvancedDraftTopLevel ? (
        <UiInlineMessage tone="warning">
          Additional notification types or top-level fields are preserved. Edit those fields in JSON.
        </UiInlineMessage>
      ) : null}

      {draftTopics.length === 0 ? (
        <BucketFeatureEditorEmpty>
          No topic notifications. Add one here or use JSON for advanced notification types.
        </BucketFeatureEditorEmpty>
      ) : (
        <BucketFeatureEditorList>
          {visibleDraftTopics.map(({ topic, index }) => (
            <NotificationTopicEditor
              key={`${notificationTopicId(topic) ?? notificationTopicArn(topic) ?? "topic"}-${index}`}
              index={index}
              topic={topic}
              disabled={saving}
              onChange={(patch) => updateDraftTopic(index, patch)}
              onRemove={() => removeDraftTopic(index)}
            />
          ))}
        </BucketFeatureEditorList>
      )}
    </div>
  );

  const jsonEditor = (
    <BucketFeatureJsonPane
      description="Edit the complete S3 notification configuration object. Switching back to Visual validates the JSON first."
      label="Notification configuration (JSON)"
      value={jsonText}
      onChange={updateJsonText}
      disabled={saving}
    >
      <p className="settings-description">
        Need a topic? Create it in the Topics section, then use its TopicArn here.
      </p>
    </BucketFeatureJsonPane>
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
        editLabel="JSON"
        onEdit={openJsonEditor}
        primaryAction={
          <SettingsButton
            type="button"
            variant="primary"
            onClick={openEditorWithNew}
            disabled={notImplemented || loading || saving}
          >
            Add notification
          </SettingsButton>
        }
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
            containerClassName="bucket-feature-collection-table"
          />
          <div className="bucket-feature-add-row">
            <span>Common SNS topic notifications can be managed here; advanced notification types remain in JSON.</span>
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={openEditorWithNew}
              disabled={notImplemented || loading || saving}
            >
              + Add notification
            </SettingsButton>
          </div>
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
