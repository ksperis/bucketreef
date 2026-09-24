/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type NotificationConfigurationRecord = Record<string, unknown>;
export type NotificationTopicRecord = Record<string, unknown>;

export type NotificationVisualTopicDraft = {
  id: string;
  topicArn: string;
  events: string[];
  prefix: string;
  suffix: string;
};

export type NotificationVisualTopicPatch = Partial<NotificationVisualTopicDraft>;

export const commonNotificationEvents = [
  { value: "s3:ObjectCreated:*", label: "All object created events" },
  { value: "s3:ObjectRemoved:*", label: "All object removed events" },
  { value: "s3:ObjectRestore:*", label: "All object restore events" },
  { value: "s3:Replication:*", label: "All replication events" },
] as const;

const supportedTopicKeys = new Set(["Id", "TopicArn", "Events", "Filter"]);
const supportedTopLevelKeys = new Set(["TopicConfigurations"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSupportedFilter(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(["Key"]))) return false;
  if (value.Key === undefined) return true;
  if (!isPlainRecord(value.Key) || !hasOnlyKeys(value.Key, new Set(["FilterRules"]))) return false;
  if (value.Key.FilterRules === undefined) return true;
  if (!Array.isArray(value.Key.FilterRules)) return false;

  const seenNames = new Set<string>();
  for (const rawRule of value.Key.FilterRules) {
    if (!isPlainRecord(rawRule) || !hasOnlyKeys(rawRule, new Set(["Name", "Value"]))) {
      return false;
    }
    if (
      (rawRule.Name !== "prefix" && rawRule.Name !== "suffix") ||
      typeof rawRule.Value !== "string"
    ) {
      return false;
    }
    if (seenNames.has(rawRule.Name)) return false;
    seenNames.add(rawRule.Name);
  }
  return true;
}

export function notificationTopicConfigurations(
  configuration: NotificationConfigurationRecord,
): NotificationTopicRecord[] {
  const topics = configuration.TopicConfigurations;
  if (!Array.isArray(topics)) return [];
  return topics.filter(isPlainRecord);
}

export function hasAdvancedNotificationTopLevel(
  configuration: NotificationConfigurationRecord,
): boolean {
  if (Object.keys(configuration).some((key) => !supportedTopLevelKeys.has(key))) return true;
  return (
    configuration.TopicConfigurations !== undefined &&
    !Array.isArray(configuration.TopicConfigurations)
  );
}

export function isNotificationTopicVisuallyEditable(topic: NotificationTopicRecord): boolean {
  if (!hasOnlyKeys(topic, supportedTopicKeys)) return false;
  if (topic.Id !== undefined && typeof topic.Id !== "string") return false;
  if (topic.TopicArn !== undefined && typeof topic.TopicArn !== "string") return false;
  if (topic.Events !== undefined && !isStringArray(topic.Events)) return false;
  return isSupportedFilter(topic.Filter);
}

export function hasAdvancedNotificationConfiguration(
  configuration: NotificationConfigurationRecord,
): boolean {
  if (hasAdvancedNotificationTopLevel(configuration)) return true;
  const topics = configuration.TopicConfigurations;
  if (!Array.isArray(topics)) return false;
  return topics.some(
    (topic) => !isPlainRecord(topic) || !isNotificationTopicVisuallyEditable(topic),
  );
}

function filterValues(topic: NotificationTopicRecord): { prefix: string; suffix: string } {
  if (!isPlainRecord(topic.Filter) || !isPlainRecord(topic.Filter.Key)) {
    return { prefix: "", suffix: "" };
  }
  const rules = topic.Filter.Key.FilterRules;
  if (!Array.isArray(rules)) return { prefix: "", suffix: "" };
  let prefix = "";
  let suffix = "";
  rules.forEach((rawRule) => {
    if (!isPlainRecord(rawRule) || typeof rawRule.Value !== "string") return;
    if (rawRule.Name === "prefix") prefix = rawRule.Value;
    if (rawRule.Name === "suffix") suffix = rawRule.Value;
  });
  return { prefix, suffix };
}

export function readNotificationVisualTopic(
  topic: NotificationTopicRecord,
): NotificationVisualTopicDraft {
  const { prefix, suffix } = filterValues(topic);
  return {
    id: typeof topic.Id === "string" ? topic.Id : "",
    topicArn: typeof topic.TopicArn === "string" ? topic.TopicArn : "",
    events: isStringArray(topic.Events) ? [...topic.Events] : [],
    prefix,
    suffix,
  };
}

function buildFilter(prefix: string, suffix: string): Record<string, unknown> | undefined {
  const filterRules: Record<string, string>[] = [];
  if (prefix) filterRules.push({ Name: "prefix", Value: prefix });
  if (suffix) filterRules.push({ Name: "suffix", Value: suffix });
  if (filterRules.length === 0) return undefined;
  return { Key: { FilterRules: filterRules } };
}

function updateNotificationVisualTopic(
  topic: NotificationTopicRecord,
  patch: NotificationVisualTopicPatch,
): NotificationTopicRecord {
  if (!isNotificationTopicVisuallyEditable(topic)) return topic;
  const current = readNotificationVisualTopic(topic);
  const next = { ...topic };

  if (patch.id !== undefined) {
    if (patch.id === "") delete next.Id;
    else next.Id = patch.id;
  }
  if (patch.topicArn !== undefined) next.TopicArn = patch.topicArn;
  if (patch.events !== undefined) next.Events = [...patch.events];
  if (patch.prefix !== undefined || patch.suffix !== undefined) {
    const filter = buildFilter(
      patch.prefix ?? current.prefix,
      patch.suffix ?? current.suffix,
    );
    if (filter) next.Filter = filter;
    else delete next.Filter;
  }
  return next;
}

export function createVisualNotificationTopic(id: string): NotificationTopicRecord {
  return {
    Id: id,
    TopicArn: "",
    Events: ["s3:ObjectCreated:*"],
  };
}

export function updateNotificationTopicAt(
  configuration: NotificationConfigurationRecord,
  index: number,
  patch: NotificationVisualTopicPatch,
): NotificationConfigurationRecord {
  if (!Array.isArray(configuration.TopicConfigurations)) return configuration;
  return {
    ...configuration,
    TopicConfigurations: configuration.TopicConfigurations.map((topic, topicIndex) =>
      topicIndex === index && isPlainRecord(topic)
        ? updateNotificationVisualTopic(topic, patch)
        : topic,
    ),
  };
}

export function addNotificationTopic(
  configuration: NotificationConfigurationRecord,
  topic: NotificationTopicRecord,
): NotificationConfigurationRecord {
  const topics = configuration.TopicConfigurations;
  if (topics !== undefined && !Array.isArray(topics)) return configuration;
  return {
    ...configuration,
    TopicConfigurations: [...(topics ?? []), topic],
  };
}

export function removeNotificationTopicAt(
  configuration: NotificationConfigurationRecord,
  index: number,
): NotificationConfigurationRecord {
  if (!Array.isArray(configuration.TopicConfigurations)) return configuration;
  const topics = configuration.TopicConfigurations.filter((_, topicIndex) => topicIndex !== index);
  const next = { ...configuration };
  if (topics.length === 0) delete next.TopicConfigurations;
  else next.TopicConfigurations = topics;
  return next;
}

export function parseNotificationConfigurationJson(
  text: string,
): { configuration: NotificationConfigurationRecord | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { configuration: null, error: "Notification configuration JSON is invalid." };
  }
  if (!isPlainRecord(parsed)) {
    return { configuration: null, error: "Notification configuration must be a JSON object." };
  }
  if (
    parsed.TopicConfigurations !== undefined &&
    !Array.isArray(parsed.TopicConfigurations)
  ) {
    return { configuration: null, error: "TopicConfigurations must be an array." };
  }
  if (
    Array.isArray(parsed.TopicConfigurations) &&
    parsed.TopicConfigurations.some((topic) => !isPlainRecord(topic))
  ) {
    return {
      configuration: null,
      error: "Each TopicConfigurations entry must be a JSON object.",
    };
  }
  return { configuration: parsed, error: null };
}

export function validateNotificationVisualConfiguration(
  configuration: NotificationConfigurationRecord,
): string | null {
  if (!Array.isArray(configuration.TopicConfigurations)) return null;
  for (let index = 0; index < configuration.TopicConfigurations.length; index += 1) {
    const topic = configuration.TopicConfigurations[index];
    if (!isPlainRecord(topic) || !isNotificationTopicVisuallyEditable(topic)) continue;
    const draft = readNotificationVisualTopic(topic);
    if (!draft.topicArn.trim()) {
      return `Topic notification ${index + 1}: Topic ARN is required.`;
    }
    if (draft.events.length === 0 || draft.events.some((event) => !event.trim())) {
      return `Topic notification ${index + 1}: at least one valid event is required.`;
    }
  }
  return null;
}

export function notificationTopicId(topic: NotificationTopicRecord): string | null {
  return typeof topic.Id === "string" && topic.Id ? topic.Id : null;
}

export function notificationTopicArn(topic: NotificationTopicRecord): string | null {
  return typeof topic.TopicArn === "string" && topic.TopicArn ? topic.TopicArn : null;
}

export function notificationTopicEventsLabel(topic: NotificationTopicRecord): string {
  if (!isStringArray(topic.Events) || topic.Events.length === 0) return "No events";
  if (topic.Events.length <= 2) return topic.Events.join(", ");
  return `${topic.Events.slice(0, 2).join(", ")} +${topic.Events.length - 2}`;
}

export function notificationTopicFilterLabel(topic: NotificationTopicRecord): string {
  if (!isNotificationTopicVisuallyEditable(topic)) {
    return topic.Filter === undefined ? "None" : "Advanced filter";
  }
  const { prefix, suffix } = filterValues(topic);
  const parts = [prefix ? `prefix=${prefix}` : null, suffix ? `suffix=${suffix}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "None";
}
