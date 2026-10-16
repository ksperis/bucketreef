/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";

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
  const { data } = await client.get<Topic[]>("/manager/topics", { params: withS3ContextParam(undefined, contextId) });
  return data;
}

export async function createTopic(contextId: S3ExecutionContextSelector, payload: CreateTopicPayload): Promise<Topic> {
  const { data } = await client.post<Topic>("/manager/topics", payload, { params: withS3ContextParam(undefined, contextId) });
  return data;
}

export async function deleteTopic(contextId: S3ExecutionContextSelector, topicArn: string): Promise<void> {
  await client.delete(`/manager/topics/${encodeURIComponent(topicArn)}`, {
    params: withS3ContextParam(undefined, contextId),
  });
}

export async function getTopicPolicy(contextId: S3ExecutionContextSelector, topicArn: string): Promise<TopicPolicy> {
  const { data } = await client.get<TopicPolicy>(`/manager/topics/${encodeURIComponent(topicArn)}/policy`, {
    params: withS3ContextParam(undefined, contextId),
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
    { params: withS3ContextParam(undefined, contextId) }
  );
  return data;
}

export async function getTopicConfiguration(
  contextId: S3ExecutionContextSelector,
  topicArn: string
): Promise<TopicConfiguration> {
  const { data } = await client.get<TopicConfiguration>(`/manager/topics/${encodeURIComponent(topicArn)}/configuration`, {
    params: withS3ContextParam(undefined, contextId),
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
    { params: withS3ContextParam(undefined, contextId) }
  );
  return data;
}
