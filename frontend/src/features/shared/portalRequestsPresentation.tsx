/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiBadge from "../../components/ui/UiBadge";
import type { UiTone } from "../../components/ui/styles";
import type {
  PortalAdminRequest,
  PortalAdminRequestStatus,
  PortalAdminRequestType,
  PortalSettingKey,
} from "../../api/portalRequests";

export function portalRequestTypeLabel(type: PortalAdminRequestType): string {
  if (type === "portal_user_access") return "Collaborator access";
  if (type === "portal_user_removal") return "Remove collaborator";
  if (type === "account_quota_change") return "Storage limit";
  if (type === "portal_setting_change") return "Project setting";
  return type;
}

export function portalSettingLabel(setting: PortalSettingKey | string): string {
  if (setting === "browser_access_enabled") return "Browser workspace access";
  if (setting === "allow_private_storage_space_create") return "Private Storage Space creation";
  if (setting === "allow_portal_named_bucket_create") return "Named bucket creation";
  if (setting === "allow_portal_user_access_key_create") return "Personal access keys";
  if (setting === "allow_portal_user_external_sharing") return "External sharing by Portal users";
  if (setting === "server_access_logging_enabled") return "Server access logging";
  if (setting === "storage_space_version_cleanup_enabled") return "Storage Space history cleanup";
  if (setting === "bucket_defaults.versioning") return "Versioning";
  if (setting === "bucket_defaults.enable_lifecycle") return "Lifecycle";
  if (setting === "bucket_defaults.enable_cors") return "CORS";
  if (setting === "bucket_defaults.noncurrent_version_expiration_days") return "Version history retention";
  if (setting === "bucket_defaults.cors_allowed_origins") return "CORS origins";
  return setting;
}

function portalSettingValueLabel(setting: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (setting === "bucket_defaults.noncurrent_version_expiration_days" && typeof value === "number") {
    return `${value} day${value === 1 ? "" : "s"}`;
  }
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "No origins";
  return String(value ?? "-");
}

function portalRequestStatusLabel(status: PortalAdminRequestStatus): string {
  if (status === "pending") return "Pending";
  if (status === "processing") return "Processing";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "failed") return "Failed";
  return status;
}

function portalRequestStatusTone(status: PortalAdminRequestStatus): UiTone {
  if (status === "approved") return "success";
  if (status === "rejected" || status === "failed") return "danger";
  if (status === "processing") return "warning";
  return "info";
}

export function PortalRequestStatusBadge({ status }: { status: PortalAdminRequestStatus }) {
  return <UiBadge tone={portalRequestStatusTone(status)}>{portalRequestStatusLabel(status)}</UiBadge>;
}

export function portalRequestPayloadSummary(request: PortalAdminRequest): string {
  const payload = request.payload ?? {};
  if (request.request_type === "portal_user_access") {
    const name = typeof payload.target_name === "string" ? payload.target_name : "New user";
    const email = typeof payload.target_email === "string" ? payload.target_email : "";
    return email ? `${name} <${email}>` : name;
  }
  if (request.request_type === "portal_user_removal") {
    const name = typeof payload.target_name === "string" ? payload.target_name : "Portal user";
    const email = typeof payload.target_email === "string" ? payload.target_email : "";
    return email ? `Remove ${name} <${email}>` : `Remove ${name}`;
  }
  if (request.request_type === "account_quota_change") {
    const direction = payload.direction === "decrease" ? "Lower" : "Raise";
    const value = typeof payload.target_quota_value === "number" || typeof payload.target_quota_value === "string"
      ? payload.target_quota_value
      : "";
    const unit = typeof payload.target_quota_unit === "string" ? payload.target_quota_unit : "";
    return `${direction} to ${value} ${unit}`.trim();
  }
  if (request.request_type === "portal_setting_change") {
    const setting = typeof payload.setting === "string" ? payload.setting : "";
    const label = portalSettingLabel(setting);
    if (payload.mode === "inherit") return `${label}: Platform value`;
    return `${label}: ${portalSettingValueLabel(setting, payload.value)}`;
  }
  return "-";
}

export function portalRequestReason(request: PortalAdminRequest): string {
  const reason = request.payload?.reason;
  return typeof reason === "string" ? reason : "";
}
