/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";

import { PRODUCT_SUBTITLE } from "../../constants/product";
import { useI18n, type I18nMessage } from "../../i18n";

const m = (en: string, zh: string): I18nMessage => ({ en, zh });

export const authMessages = {
  password: m("Password", "密码"),
  passwordActionLabel: m("password", "密码"),
  secretKey: m("Secret key", "密钥"),
  secretKeyActionLabel: m("secret key", "密钥"),
  show: m("Show", "显示"),
  hide: m("Hide", "隐藏"),
  showSecret: m("Show {label}", "显示{label}"),
  hideSecret: m("Hide {label}", "隐藏{label}"),

  bootstrapTokenMissingComplete: m(
    "The bootstrap token is missing. Open the complete one-time URL issued by the backend.",
    "引导令牌缺失。请打开后端签发的完整一次性 URL。",
  ),
  bootstrapTokenMissingIssue: m(
    "The bootstrap token is missing. Issue a new one-time URL from the backend.",
    "引导令牌缺失。请从后端签发新的一次性 URL。",
  ),
  passwordsMismatch: m("Passwords do not match.", "两次输入的密码不一致。"),
  administratorSessionLoadFailed: m(
    "The administrator session could not be loaded.",
    "无法加载管理员会话。",
  ),
  administratorAuthIncomplete: m(
    "Administrator authentication did not complete.",
    "管理员身份验证未完成。",
  ),
  bootstrapLinkInvalid: m(
    "The bootstrap link is invalid, expired, or already used.",
    "引导链接无效、已过期或已使用。",
  ),
  initialSetup: m("Initial setup", "初始设置"),
  createFirstAdministrator: m(
    "Create the first administrator",
    "创建首位管理员",
  ),
  firstAdministratorDescription: m(
    "This one-time setup creates the platform super-administrator. A passkey is optional during onboarding and should be enabled before production.",
    "此一次性设置将创建平台超级管理员。引导过程中可以暂不设置通行密钥，但在生产环境使用前应启用。",
  ),
  checkingBootstrapLink: m("Checking the bootstrap link…", "正在检查引导链接…"),
  fullName: m("Full name", "姓名"),
  email: m("Email", "邮箱"),
  confirmPassword: m("Confirm password", "确认密码"),
  passwordHelp: m("Use at least 12 characters.", "请至少使用 12 个字符。"),
  creatingAdministrator: m("Creating administrator…", "正在创建管理员…"),
  createAdministrator: m("Create administrator", "创建管理员"),
  alreadyInitialized: m("Already initialized?", "已经完成初始化？"),
  returnToSignIn: m("Return to sign in", "返回登录"),

  unableToSignIn: m("Unable to sign in. Try again.", "无法登录。请重试。"),
  invalidEmailPassword: m(
    "Invalid email or password.",
    "邮箱或密码无效。",
  ),
  tooManySignInAttempts: m(
    "Too many sign-in attempts. Try again later.",
    "登录尝试次数过多。请稍后重试。",
  ),
  unableReachBucketReef: m(
    "Unable to reach BucketReef. Check your connection and try again.",
    "无法连接到 BucketReef。请检查网络连接后重试。",
  ),
  authenticationRequiresApproval: m(
    "Authentication requires administrator approval",
    "身份验证需要管理员批准",
  ),
  unableLoadIdentityProviders: m(
    "Unable to load identity providers",
    "无法加载身份提供方",
  ),
  unableLoadDirectoryProviders: m(
    "Unable to load directory providers",
    "无法加载目录提供方",
  ),
  unableLoadEndpointOptions: m(
    "Unable to load endpoint options",
    "无法加载端点选项",
  ),
  noDirectoryProvider: m(
    "No directory provider is available",
    "没有可用的目录提供方",
  ),
  unableAuthenticateDirectory: m(
    "Unable to authenticate with this directory account",
    "无法使用此目录账户进行身份验证",
  ),
  unableAuthenticateAccessKeys: m(
    "Unable to authenticate with these access keys",
    "无法使用这些访问密钥进行身份验证",
  ),
  unableStartExternalAuthentication: m(
    "Unable to start external authentication",
    "无法启动外部身份验证",
  ),
  passkeyVerificationFailed: m(
    "Passkey verification failed. Please try again.",
    "通行密钥验证失败。请重试。",
  ),
  recoveryCodeInvalid: m(
    "The recovery code is invalid or has already been used.",
    "恢复码无效或已使用。",
  ),

  createAdministratorPasskey: m(
    "Create your administrator passkey",
    "创建管理员通行密钥",
  ),
  verifyPasskey: m("Verify your passkey", "验证通行密钥"),
  administratorPasskeyDescription: m(
    "Administrator access requires user verification with a passkey bound to this site.",
    "管理员访问需要使用绑定到此站点的通行密钥完成用户验证。",
  ),
  createPasskey: m("Create passkey", "创建通行密钥"),
  usePasskey: m("Use passkey", "使用通行密钥"),
  recoveryCode: m("Recovery code", "恢复码"),
  useRecoveryCode: m("Use recovery code", "使用恢复码"),
  saveRecoveryCodesNow: m(
    "Save these one-time recovery codes now.",
    "请立即保存这些一次性恢复码。",
  ),
  savedRecoveryCodes: m(
    "I saved these recovery codes",
    "我已保存这些恢复码",
  ),

  productSubtitle: m(
    PRODUCT_SUBTITLE,
    "兼容 S3 的对象存储管理",
  ),
  signInWorkspaceDescription: m(
    "Sign in to reach the workspace that matches your role and execution context.",
    "登录以访问与角色和执行上下文匹配的工作区。",
  ),
  companyLogo: m("Company logo", "公司徽标"),
  afterSignIn: m("After sign-in", "登录后"),
  afterSignInDescription: m(
    "Password sign-in opens your assigned UI workspaces. Access keys create an S3 session when that mode is enabled.",
    "使用密码登录后将打开分配给你的 UI 工作区。启用访问密钥模式后，访问密钥会创建 S3 会话。",
  ),
  needHelp: m("Need help?", "需要帮助？"),
  needHelpDescription: m(
    "Contact your platform admin if you don't know which sign-in method or endpoint to use.",
    "如果你不知道应使用哪种登录方式或端点，请联系平台管理员。",
  ),
  securityNote: m("Security note", "安全提示"),
  securityNoteDescription: m(
    "Never share your password, secret key, or session token.",
    "请勿分享密码、密钥或会话令牌。",
  ),
  signIn: m("Sign in", "登录"),
  accountCredentials: m("Use your account credentials.", "使用账户凭据。"),
  emailAndPassword: m("Email & password", "邮箱和密码"),
  directory: m("Directory", "目录"),
  s3AccessKeys: m("S3 access keys", "S3 访问密钥"),
  username: m("Username", "用户名"),
  usernamePlaceholder: m(
    "jane.doe or jane@example.com",
    "jane.doe 或 jane@example.com",
  ),
  signInWithDirectory: m("Sign in with directory", "使用目录登录"),
  signingIn: m("Signing in...", "正在登录…"),
  accessKey: m("Access key", "访问密钥"),
  accessKeyPlaceholder: m("ACCESS_KEY", "ACCESS_KEY"),
  endpoint: m("Endpoint", "端点"),
  loadingEndpoints: m("Loading endpoints...", "正在加载端点…"),
  selectEndpoint: m("Select endpoint", "选择端点"),
  defaultEndpoint: m("{name} (default)", "{name}（默认）"),
  noEndpointUseCustom: m(
    "No endpoint configured. Use a custom endpoint URL.",
    "未配置端点。请使用自定义端点 URL。",
  ),
  noEndpointAskAdmin: m(
    "No endpoint configured. Ask an admin to add one.",
    "未配置端点。请让管理员添加端点。",
  ),
  customEndpointOptional: m(
    "Custom endpoint URL (optional)",
    "自定义端点 URL（可选）",
  ),
  customEndpointPlaceholder: m(
    "https://s3.example.com",
    "https://s3.example.com",
  ),
  customEndpointOverrides: m(
    "Custom endpoint overrides the selection above.",
    "自定义端点会覆盖上面的选择。",
  ),
  connecting: m("Connecting...", "正在连接…"),
  connectWithKeys: m("Connect with keys", "使用密钥连接"),
  or: m("Or", "或"),
  redirecting: m("Redirecting...", "正在跳转…"),
  continueWithProvider: m(
    "Continue with {provider}",
    "通过 {provider} 继续",
  ),

  missingIdentityProvider: m("Missing identity provider.", "缺少身份提供方。"),
  incompleteAuthenticationResponse: m(
    "Incomplete authentication response.",
    "身份验证响应不完整。",
  ),
  identityApprovalRequired: m(
    "This identity must be approved by a superadministrator before it can be linked.",
    "此身份必须经超级管理员批准后才能关联。",
  ),
  oidcSessionMissingUser: m(
    "OIDC session did not return a user",
    "OIDC 会话未返回用户",
  ),
  unableCompleteSignIn: m(
    "Unable to complete the sign-in. Please try again.",
    "无法完成登录。请重试。",
  ),
  signingYouIn: m("Signing you in", "正在为你登录"),
  pleaseWait: m("Please wait...", "请稍候…"),
} as const;

export type AuthMessageKey = keyof typeof authMessages;
export type AuthText = (
  key: AuthMessageKey,
  values?: Record<string, string | number>,
) => string;

export function useAuthI18n() {
  const { t, locale } = useI18n();
  const text: AuthText = useCallback(
    (key, values) =>
      t(authMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
        String(values?.[name] ?? match),
      ),
    [t],
  );
  return { text, locale };
}
