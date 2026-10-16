/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3ExecutionContextSelector, withS3ContextParam } from "./accountParams";
import type { AuditStatus } from "./audit";
import client from "./client";

export type ManagerActivityEntry = {
  id: number;
  created_at: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  context_kind?: string | null;
  context_id?: string | null;
  context_name?: string | null;
  status: AuditStatus;
  user_email: string;
};

export async function listManagerActivity(
  contextId: S3ExecutionContextSelector,
  options?: { limit?: number; cursor?: number; search?: string; status?: AuditStatus }
): Promise<ManagerActivityEntry[]> {
  const { data } = await client.get<ManagerActivityEntry[]>("/manager/activity", {
    params: withS3ContextParam({
      limit: options?.limit ?? 5,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.search?.trim() ? { search: options.search.trim() } : {}),
      ...(options?.status ? { status: options.status } : {}),
    }, contextId),
  });
  return data;
}
