/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CheckLevel } from "../../api/productionReadiness";
import type { I18nMessage } from "../../i18n";

export const productionReadinessMessages = {
  title: { en: "Production readiness", zh: "生产就绪检查" },
  description: {
    en: "Security, deployment and operational checks for this backend runtime.",
    zh: "检查当前后端运行环境的安全、部署和运维配置。",
  },
  adminWorkspace: { en: "Admin", zh: "管理" },
  refresh: { en: "Refresh", zh: "刷新" },
  refreshing: { en: "Refreshing…", zh: "正在刷新…" },
  evaluationError: { en: "Unable to evaluate production readiness.", zh: "无法评估生产就绪状态。" },
  evaluating: { en: "Evaluating this backend runtime…", zh: "正在评估当前后端运行环境…" },
  reportDescription: {
    en: "This report evaluates the production target for this backend instance. Findings marked as startup-blocking can prevent backend startup; critical findings remain operational so they can be corrected before publication.",
    zh: "此报告评估当前后端实例是否满足生产部署要求。标记为阻止启动的问题可能阻止后端启动；严重问题不会阻止运行，以便在上线前完成修正。",
  },
  overview: { en: "Readiness overview", zh: "就绪状态概览" },
  overviewDescription: {
    en: "The five readiness levels used by startup diagnostics, the CLI and this page.",
    zh: "启动诊断、命令行工具和此页面共用的五种就绪等级。",
  },
  environment: { en: "Environment", zh: "环境" },
  profile: { en: "Profile", zh: "部署模式" },
  overall: { en: "Overall", zh: "总体状态" },
  readinessLevels: { en: "Readiness levels", zh: "就绪等级" },
  allLevelsVisible: {
    en: "All five levels remain visible, including levels with no current findings.",
    zh: "始终显示全部五种等级，包括当前没有检查结果的等级。",
  },
  blocksStartup: {
    en: "Blocks application startup in the current runtime.",
    zh: "此问题会阻止应用在当前运行环境中启动。",
  },
  documentation: { en: "Documentation", zh: "文档" },
  deploymentChecks: { en: "Deployment checks", zh: "部署检查" },
  deploymentChecksDescription: {
    en: "Findings are grouped by readiness level. Successful checks stay collapsed by default.",
    zh: "检查结果按就绪等级分组。通过的检查项默认折叠。",
  },
  showSuccessfulCheck: { en: "Show {count} successful check", zh: "显示 {count} 项通过的检查" },
  showSuccessfulChecks: { en: "Show {count} successful checks", zh: "显示 {count} 项通过的检查" },
} satisfies Record<string, I18nMessage>;

export const productionReadinessLevelLabels: Record<CheckLevel, I18nMessage> = {
  blocked: { en: "Blocked", zh: "阻断" },
  critical: { en: "Critical", zh: "严重" },
  warning: { en: "Warning", zh: "警告" },
  manual: { en: "Manual", zh: "人工确认" },
  ok: { en: "OK", zh: "通过" },
};

export const productionReadinessGroupDescriptions: Record<CheckLevel, I18nMessage> = {
  blocked: {
    en: "Obvious security problems. In production, checks marked as startup-blocking prevent the backend from serving requests.",
    zh: "明显的安全问题。在生产环境中，标记为阻止启动的检查项会阻止后端处理请求。",
  },
  critical: {
    en: "Important production-readiness gaps that should be corrected before publication, without preventing application startup.",
    zh: "应在上线前修正的重要生产就绪问题，但不会阻止应用启动。",
  },
  warning: {
    en: "Configuration choices that can be valid but deserve explicit operator review.",
    zh: "这些配置选择可能合理，但需要运维人员明确核查。",
  },
  manual: {
    en: "Operational properties that cannot be proven safely from this backend instance and require human verification.",
    zh: "当前后端实例无法安全验证的运维条件，需要人工确认。",
  },
  ok: {
    en: "Automated checks that currently satisfy their expected configuration.",
    zh: "当前符合预期配置的自动检查项。",
  },
};

export const productionReadinessLevelSummaries: Record<CheckLevel, I18nMessage> = {
  blocked: { en: "Can prevent startup in production.", zh: "可能阻止生产环境启动。" },
  critical: { en: "Correct before production publication.", zh: "应在生产环境上线前修正。" },
  warning: { en: "Review against your deployment context.", zh: "请结合实际部署环境核查。" },
  manual: { en: "Requires explicit operator verification.", zh: "需要运维人员明确确认。" },
  ok: { en: "Automated checks currently satisfied.", zh: "当前已通过自动检查。" },
};
