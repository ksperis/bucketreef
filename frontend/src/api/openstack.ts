/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import client from "./client";

export type OpenStackCloudWrite = {
  name: string; auth_url: string; enabled: boolean; allow_password: boolean; allow_token: boolean;
  managed_endpoints_only: boolean; default_domain: string | null;
};
export type OpenStackCloud = OpenStackCloudWrite & { id: number };
export type OpenStackPublicCloud = {
  id: number; name: string; allow_password: boolean; allow_token: boolean; default_domain: string | null;
};
export type OpenStackConnection = {
  id: string; cloud_id: number; cloud_name: string; display_name: string; keystone_user_id: string;
  connected: boolean; expires_at: string | null;
};
export type OpenStackProject = { id: string; name: string; domain_id: string | null };
export type OpenStackProjectOption = {
  connection_id: string;
  cloud_id: number;
  cloud_name: string;
  identity_name: string;
  keystone_user_id: string;
  project_id: string;
  project_name: string;
  project_domain_id: string | null;
};
export type OpenStackTarget = {
  target_id: string;
  region_id: string;
  interface: "public" | "internal";
  service_type: string;
  service_name: string | null;
  endpoint_url: string;
  storage_endpoint_id: number | null;
  storage_endpoint_name: string | null;
  allowed: boolean;
};
export type OpenStackProjectAccess = {
  targets: OpenStackTarget[];
  access_keys: string[];
};
const OPENSTACK_PROJECT_OPTION_PREFIX = "openstack-project-option:";
export function openStackProjectOptionValue(option: Pick<OpenStackProjectOption, "connection_id" | "project_id">): string {
  return `${OPENSTACK_PROJECT_OPTION_PREFIX}${encodeURIComponent(option.connection_id)}:${encodeURIComponent(option.project_id)}`;
}
type OpenStackAuthentication = {
  cloud_id: number; method: "password" | "token"; username?: string; user_id?: string;
  domain?: string; domain_is_id?: boolean; password?: string; token?: string;
};
const root = "/me/openstack";
export async function listOpenStackClouds(): Promise<OpenStackPublicCloud[]> {
  return (await client.get<OpenStackPublicCloud[]>(`${root}/clouds`)).data;
}
export async function listOpenStackConnections(): Promise<OpenStackConnection[]> {
  return (await client.get<OpenStackConnection[]>(`${root}/connections`)).data;
}
export async function connectOpenStack(payload: OpenStackAuthentication): Promise<OpenStackConnection> {
  return (await client.post<OpenStackConnection>(`${root}/connections`, payload)).data;
}
export async function listOpenStackProjects(id: string): Promise<OpenStackProject[]> {
  return (await client.get<OpenStackProject[]>(`${root}/connections/${encodeURIComponent(id)}/projects`)).data;
}
export async function listOpenStackProjectOptions(): Promise<OpenStackProjectOption[]> {
  return (await client.get<OpenStackProjectOption[]>(`${root}/project-options`)).data;
}
export async function getOpenStackProjectAccess(id: string, project: string): Promise<OpenStackProjectAccess> {
  return (await client.get<OpenStackProjectAccess>(`${root}/connections/${encodeURIComponent(id)}/projects/${encodeURIComponent(project)}/access`)).data;
}
export async function activateOpenStackContext(id: string, project_id: string, target_id: string, access_key?: string): Promise<string> {
  return (await client.post<{ context_id: string }>(`${root}/connections/${encodeURIComponent(id)}/contexts`, { project_id, target_id, access_key })).data.context_id;
}
export async function disconnectOpenStack(id: string, forget = false): Promise<void> {
  await client.delete(`${root}/connections/${encodeURIComponent(id)}${forget ? "" : "/session"}`);
}
export async function listAdminOpenStackClouds(): Promise<OpenStackCloud[]> {
  return (await client.get<OpenStackCloud[]>("/admin/openstack-clouds")).data;
}
export async function saveOpenStackCloud(payload: OpenStackCloudWrite, id?: number): Promise<OpenStackCloud> {
  return (id == null ? await client.post<OpenStackCloud>("/admin/openstack-clouds", payload) : await client.put<OpenStackCloud>(`/admin/openstack-clouds/${id}`, payload)).data;
}
export async function deleteOpenStackCloud(id: number): Promise<void> {
  await client.delete(`/admin/openstack-clouds/${id}`);
}
