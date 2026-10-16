/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n } from "../../i18n";
import { adminMessage } from "./adminI18n";

const m = (en: string, zh: string) => adminMessage(en, zh);

export const identitySecurityMessage = {
  admin: m("Admin", "管理员"),
  title: m("Identity Security", "身份安全"),
  description: m("Review external identity link requests and manage active platform sessions within your administrative scope.", "在你的管理范围内审核外部身份关联请求，并管理活跃的平台会话。"),
  ldap: m("LDAP", "LDAP"),
  oidc: m("OIDC", "OIDC"),
  passkey: m("Passkey", "通行密钥"),
  password: m("Password", "密码"),
  s3AccessKey: m("S3 access key", "S3 访问密钥"),
  userNumber: m("User #{id}", "用户 #{id}"),
  s3Session: m("S3 session", "S3 会话"),
  loadError: m("Unable to load identity security data.", "无法加载身份安全数据。"),
  linkApproved: m("Identity link approved.", "身份关联已批准。"),
  linkRejected: m("Identity link rejected.", "身份关联已拒绝。"),
  updateError: m("Unable to update the identity request.", "无法更新身份关联请求。"),
  localAccount: m("Local account", "本地账户"),
  provider: m("Provider", "提供方"),
  claimedEmail: m("Claimed email", "声明的邮箱"),
  expires: m("Expires", "到期时间"),
  actions: m("Actions", "操作"),
  approve: m("Approve", "批准"),
  reject: m("Reject", "拒绝"),
  user: m("User", "用户"),
  current: m("Current", "当前会话"),
  authentication: m("Authentication", "认证"),
  authMethod: m("Auth method", "认证方式"),
  role: m("Role", "角色"),
  notApplicable: m("Not applicable", "不适用"),
  network: m("Network", "网络"),
  unknown: m("Unknown", "未知"),
  lastActivity: m("Last activity", "最近活动时间"),
  revoked: m("Revoked", "已撤销"),
  revoke: m("Revoke", "撤销"),
  sessionRevoked: m("Session revoked.", "会话已撤销。"),
  revokeError: m("Unable to revoke the session.", "无法撤销会话。"),
  retry: m("Retry", "重试"),
  loading: m("Loading identity security data...", "正在加载身份安全数据…"),
  views: m("Identity security views", "身份安全视图"),
  linkRequests: m("Link requests ({count})", "关联请求（{count}）"),
  requestTitle: m("External identity link requests", "外部身份关联请求"),
  requestHelp: m("Decide only when the external identity and local account have been verified through a trusted channel.", "请通过可信渠道核实外部身份与本地账户后，再作出决定。"),
  refresh: m("Refresh", "刷新"),
  loadingRequests: m("Loading identity link requests...", "正在加载身份关联请求…"),
  requestsError: m("Unable to load identity link requests.", "无法加载身份关联请求。"),
  noRequests: m("No pending identity link requests.", "没有待处理的身份关联请求。"),
  activeSessions: m("Active sessions ({count})", "活跃会话（{count}）"),
  sessionTitle: m("Platform sessions", "平台会话"),
  sessionHelp: m("Revoke a session to remove its access immediately. Only sessions inside your administrative scope are shown.", "撤销会话会立即移除其访问权限。这里只显示你管理范围内的会话。"),
  loadingSessions: m("Loading platform sessions...", "正在加载平台会话…"),
  sessionsError: m("Unable to load platform sessions.", "无法加载平台会话。"),
  noSessions: m("No active sessions.", "没有活跃会话。"),
  approveTitle: m("Approve identity link", "批准身份关联"),
  rejectTitle: m("Reject identity link request", "拒绝身份关联请求"),
  approveDescription: m("This external identity will be linked to the selected local account.", "此外部身份将关联到所选的本地账户。"),
  rejectDescription: m("This request will be closed without linking the external identity.", "此请求将被关闭，外部身份不会关联到本地账户。"),
  approveLink: m("Approve link", "批准关联"),
  rejectRequest: m("Reject request", "拒绝请求"),
  revokeSession: m("Revoke session", "撤销会话"),
  revokeDescription: m("This session will lose access immediately.", "此会话将立即失去访问权限。"),
  session: m("Session", "会话"),
  cancel: m("Cancel", "取消"),
  processing: m("Processing...", "正在处理…"),
  close: m("Close", "关闭"),
  verifyPasskey: m("Verify with passkey", "使用通行密钥验证"),
  verifyDescription: m("Confirm your identity to continue this sensitive action in the current session.", "请确认你的身份，以在当前会话中继续此敏感操作。"),
  verificationCancelled: m("Passkey verification was cancelled or timed out. Please try again.", "通行密钥验证已取消或超时，请重试。"),
  verificationFailed: m("Passkey verification failed. Please try again.", "通行密钥验证失败，请重试。"),
};

export type IdentitySecurityMessageKey = keyof typeof identitySecurityMessage;
export type IdentitySecurityText = (key: IdentitySecurityMessageKey, values?: Record<string, string | number>) => string;

export function useIdentitySecurityI18n() {
  const { locale, t } = useI18n();
  const text = useCallback<IdentitySecurityText>(
    (key, values) => t(identitySecurityMessage[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { locale, text };
}
