/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type ManagerCephAccessKey = {
  access_key_id: string;
  status?: string | null;
  created_at?: string | null;
  is_ui_managed: boolean;
  is_active: boolean;
  is_private_access_managed?: boolean;
  managed_connection_id?: number | null;
  name?: string | null;
  notes?: string | null;
};

export type ManagerCephGeneratedAccessKey = {
  access_key_id: string;
  secret_access_key: string;
  created_at?: string | null;
  name?: string | null;
  notes?: string | null;
};

export type ManagerAccessKeyMetadataInput = {
  name?: string | null;
  notes?: string | null;
};

export async function listManagerCephAccessKeys(accountId?: S3AccountSelector): Promise<ManagerCephAccessKey[]> {
  const { data } = await client.get<ManagerCephAccessKey[]>("/manager/ceph/keys", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createManagerCephAccessKey(
  accountId?: S3AccountSelector,
  metadata?: ManagerAccessKeyMetadataInput,
): Promise<ManagerCephGeneratedAccessKey> {
  const { data } = await client.post<ManagerCephGeneratedAccessKey>(
    "/manager/ceph/keys",
    metadata ?? {},
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updateManagerCephAccessKeyMetadata(
  accountId: S3AccountSelector,
  accessKeyId: string,
  metadata: ManagerAccessKeyMetadataInput,
): Promise<ManagerAccessKeyMetadataInput> {
  const { data } = await client.put<ManagerAccessKeyMetadataInput>(
    `/manager/ceph/keys/${encodeURIComponent(accessKeyId)}/metadata`,
    metadata,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function updateManagerCephAccessKeyStatus(
  accountId: S3AccountSelector,
  accessKeyId: string,
  active: boolean
): Promise<ManagerCephAccessKey> {
  const { data } = await client.put<ManagerCephAccessKey>(
    `/manager/ceph/keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteManagerCephAccessKey(accountId: S3AccountSelector, accessKeyId: string): Promise<void> {
  await client.delete(`/manager/ceph/keys/${encodeURIComponent(accessKeyId)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}
