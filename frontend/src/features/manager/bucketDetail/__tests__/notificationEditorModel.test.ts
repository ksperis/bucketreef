import { describe, expect, it } from "vitest";
import {
  addNotificationTopic,
  createVisualNotificationTopic,
  hasAdvancedNotificationConfiguration,
  isNotificationTopicVisuallyEditable,
  parseNotificationConfigurationJson,
  removeNotificationTopicAt,
  updateNotificationTopicAt,
} from "../notificationEditorModel";

describe("notificationEditorModel", () => {
  it("edits the supported topic subset without replacing unrelated configuration", () => {
    const configuration = {
      TopicConfigurations: [
        {
          Id: "uploads",
          TopicArn: "arn:aws:sns:default:acc:uploads",
          Events: ["s3:ObjectCreated:*"],
        },
      ],
      QueueConfigurations: [{ Id: "queue", QueueArn: "arn:aws:sqs:default:acc:q" }],
    };

    const updated = updateNotificationTopicAt(configuration, 0, {
      prefix: "incoming/",
      suffix: ".json",
    });

    expect(updated.QueueConfigurations).toEqual(configuration.QueueConfigurations);
    expect(updated.TopicConfigurations).toEqual([
      {
        Id: "uploads",
        TopicArn: "arn:aws:sns:default:acc:uploads",
        Events: ["s3:ObjectCreated:*"],
        Filter: {
          Key: {
            FilterRules: [
              { Name: "prefix", Value: "incoming/" },
              { Name: "suffix", Value: ".json" },
            ],
          },
        },
      },
    ]);
  });

  it("never rewrites an advanced topic from the visual editor", () => {
    const advanced = {
      Id: "advanced",
      TopicArn: "arn:aws:sns:default:acc:advanced",
      Events: ["s3:ObjectCreated:*"],
      Filter: {
        Key: {
          FilterRules: [{ Name: "custom", Value: "keep-me" }],
        },
      },
      Unknown: { nested: true },
    };
    const configuration = { TopicConfigurations: [advanced] };

    expect(isNotificationTopicVisuallyEditable(advanced)).toBe(false);
    expect(hasAdvancedNotificationConfiguration(configuration)).toBe(true);
    expect(updateNotificationTopicAt(configuration, 0, { id: "changed" })).toEqual(
      configuration,
    );
  });

  it("adds and removes topics while preserving advanced top-level configuration", () => {
    const initial = {
      QueueConfigurations: [{ Id: "queue" }],
    };
    const added = addNotificationTopic(initial, createVisualNotificationTopic("new-topic"));
    expect(added.QueueConfigurations).toEqual(initial.QueueConfigurations);
    expect(added.TopicConfigurations).toHaveLength(1);

    const removed = removeNotificationTopicAt(added, 0);
    expect(removed).toEqual(initial);
  });

  it("validates the JSON container without rejecting advanced fields", () => {
    expect(parseNotificationConfigurationJson("[]").error).toBe(
      "Notification configuration must be a JSON object.",
    );
    expect(parseNotificationConfigurationJson('{"TopicConfigurations":{}}').error).toBe(
      "TopicConfigurations must be an array.",
    );
    expect(
      parseNotificationConfigurationJson(
        '{"QueueConfigurations":[{"Unknown":{"keep":true}}]}',
      ).configuration,
    ).toEqual({ QueueConfigurations: [{ Unknown: { keep: true } }] });
  });
});
