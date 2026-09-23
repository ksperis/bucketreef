/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketJsonFeatureEditor from "./BucketJsonFeatureEditor";
import {
  defaultNotificationTemplate,
  type useBucketNotificationsController,
} from "./useBucketNotificationsController";

type BucketNotificationsController = ReturnType<typeof useBucketNotificationsController>;

type BucketNotificationsFeatureProps = {
  controller: BucketNotificationsController;
  exampleAccountId: string;
  onRequestClear: () => void;
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
            { "Name": "prefix", "Value": "uploads/" }
          ]
        }
      }
    }
  ]
}`;
}

export default function BucketNotificationsFeature({
  controller,
  exampleAccountId,
  onRequestClear,
}: BucketNotificationsFeatureProps) {
  const example = buildNotificationExample(exampleAccountId);
  const editorController = {
    configured: controller.configured,
    deleting: controller.clearing,
    dirty: controller.dirty,
    error: controller.error,
    loading: controller.loading,
    save: controller.save,
    saving: controller.saving,
    setText: controller.updateText,
    text: controller.text,
  };

  return (
    <BucketJsonFeatureEditor
      controller={editorController}
      title="Notifications / SNS topics"
      description="Configure S3 events delivered to SNS topics."
      testId="bucket-feature-notifications"
      label="Notification configuration (JSON)"
      rows={10}
      placeholder={defaultNotificationTemplate}
      example={example}
      exampleHelperText={<span className="settings-description">Need a topic? Create it in the Topics section.</span>}
      footer={
        <p className="settings-description">
          Only topic-based notifications are supported. Each entry should include{" "}
          <code className="font-mono ui-caption">TopicArn</code>,{" "}
          <code className="font-mono ui-caption">Events</code>, and an optional filter.
        </p>
      }
      deleteLabel="Clear"
      deletingLabel="Clearing..."
      successMessage={controller.status}
      onRequestDelete={onRequestClear}
    />
  );
}
