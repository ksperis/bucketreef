/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
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
  status: string;
  user_email: string;
};

export async function listManagerActivity(
  accountId: S3AccountSelector,
  options?: { limit?: number; cursor?: number; search?: string; status?: string }
): Promise<ManagerActivityEntry[]> {
  const { data } = await client.get<ManagerActivityEntry[]>("/manager/activity", {
    params: withS3AccountParam({
      limit: options?.limit ?? 5,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.search?.trim() ? { search: options.search.trim() } : {}),
      ...(options?.status ? { status: options.status } : {}),
    }, accountId),
  });
  return data;
}
