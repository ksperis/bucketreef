/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { S3ExecutionContextSelector } from "./accountParams";
import { buildS3ContextRequestConfig } from "./accountParams";

export type Topic = {
  name: string;
  arn: string;
  configuration: Record<string, unknown> | null;
};

type CreateTopicPayload = {
  name: string;
  configuration?: Record<string, unknown> | null;
};

type TopicPolicy = {
  policy: Record<string, unknown>;
};

type TopicConfiguration = {
  configuration: Record<string, unknown>;
};

export async function listTopics(contextId?: S3ExecutionContextSelector): Promise<Topic[]> {
  const { data } = await client.get<Topic[]>("/manager/topics", buildS3ContextRequestConfig(contextId));
  return data;
}

export async function createTopic(contextId: S3ExecutionContextSelector, payload: CreateTopicPayload): Promise<Topic> {
  const { data } = await client.post<Topic>("/manager/topics", payload, buildS3ContextRequestConfig(contextId));
  return data;
}

export async function deleteTopic(contextId: S3ExecutionContextSelector, topicArn: string): Promise<void> {
  await client.delete(`/manager/topics/${encodeURIComponent(topicArn)}`, {
    ...buildS3ContextRequestConfig(contextId),
  });
}

export async function getTopicPolicy(contextId: S3ExecutionContextSelector, topicArn: string): Promise<TopicPolicy> {
  const { data } = await client.get<TopicPolicy>(`/manager/topics/${encodeURIComponent(topicArn)}/policy`, {
    ...buildS3ContextRequestConfig(contextId),
  });
  return data;
}

export async function updateTopicPolicy(
  contextId: S3ExecutionContextSelector,
  topicArn: string,
  policy: Record<string, unknown>
): Promise<TopicPolicy> {
  const { data } = await client.put<TopicPolicy>(
    `/manager/topics/${encodeURIComponent(topicArn)}/policy`,
    { policy },
    buildS3ContextRequestConfig(contextId)
  );
  return data;
}

export async function getTopicConfiguration(
  contextId: S3ExecutionContextSelector,
  topicArn: string
): Promise<TopicConfiguration> {
  const { data } = await client.get<TopicConfiguration>(`/manager/topics/${encodeURIComponent(topicArn)}/configuration`, {
    ...buildS3ContextRequestConfig(contextId),
  });
  return data;
}

export async function updateTopicConfiguration(
  contextId: S3ExecutionContextSelector,
  topicArn: string,
  configuration: Record<string, unknown>
): Promise<TopicConfiguration> {
  const { data } = await client.put<TopicConfiguration>(
    `/manager/topics/${encodeURIComponent(topicArn)}/configuration`,
    { configuration },
    buildS3ContextRequestConfig(contextId)
  );
  return data;
}
