/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import {
  fetchProductionReadiness,
  type CheckLevel,
  type ProductionReadinessResponse,
  type ReadinessStatus,
} from "../../api/productionReadiness";
import InlineSummary from "../../components/InlineSummary";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiDetails from "../../components/ui/UiDetails";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n, type I18nMessage } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import {
  productionReadinessGroupDescriptions as groupDescription,
  productionReadinessLevelLabels as levelLabel,
  productionReadinessLevelSummaries as levelSummary,
  productionReadinessMessages as messages,
} from "./productionReadinessMessages";

const levelTone: Record<CheckLevel, "success" | "warning" | "danger" | "info" | "neutral"> = {
  blocked: "danger",
  critical: "danger",
  warning: "warning",
  manual: "info",
  ok: "success",
};

const groupOrder: CheckLevel[] = ["blocked", "critical", "warning", "manual", "ok"];

function ReadinessLevelOverview({ report }: { report: ProductionReadinessResponse }) {
  const { t } = useI18n();

  return (
    <div>
      <dl
        aria-label={t(messages.readinessLevels)}
        className="grid gap-px overflow-hidden rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-border-soft)] sm:grid-cols-2 lg:grid-cols-5"
      >
        {groupOrder.map((level) => (
          <div
            key={level}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 bg-[var(--ui-surface-muted)] px-3 py-3"
          >
            <dt>
              <UiBadge tone={levelTone[level]}>{t(levelLabel[level])}</UiBadge>
            </dt>
            <dd className={cx("text-[18px] font-semibold leading-5", uiTitleTextClass)}>
              {report.counts[level]}
            </dd>
            <dd className={cx("col-span-2 mt-2 ui-caption leading-4", uiMutedTextClass)}>
              {t(levelSummary[level])}
            </dd>
          </div>
        ))}
      </dl>
      <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
        {t(messages.allLevelsVisible)}
      </p>
    </div>
  );
}

function FindingRows({ findings }: { findings: ProductionReadinessResponse["findings"] }) {
  const { t } = useI18n();

  return (
    <div className="divide-y divide-[color:var(--ui-border-soft)] border-t border-[color:var(--ui-border-soft)]">
      {findings.map((finding) => (
        <div key={finding.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>{finding.label}</p>
            <p className={cx("ui-caption leading-5", uiMutedTextClass)}>{finding.message}</p>
            {finding.blocks_startup ? (
              <p className="mt-1 ui-caption font-medium text-[color:var(--ui-danger)]">
                {t(messages.blocksStartup)}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={cx("font-mono ui-caption", uiMutedTextClass)}>{finding.code}</span>
              <a
                href={finding.documentation_url}
                target="_blank"
                rel="noreferrer"
                className="ui-caption font-medium text-primary hover:underline dark:text-primary-200"
              >
                {t(messages.documentation)}
              </a>
            </div>
          </div>
          <UiBadge tone={levelTone[finding.level]} className="shrink-0">
            {t(levelLabel[finding.level])}
          </UiBadge>
        </div>
      ))}
    </div>
  );
}

function statusBannerTone(status: ReadinessStatus): "success" | "warning" | "error" {
  if (status === "ok") return "success";
  if (status === "warning") return "warning";
  return "error";
}

function statusLabel(status: ReadinessStatus): I18nMessage {
  return levelLabel[status];
}

export default function ProductionReadinessPage() {
  const { t } = useI18n();
  const [report, setReport] = useState<ProductionReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProductionReadiness(signal);
      setReport(next);
    } catch (err) {
      if (signal?.aborted) return;
      setError(extractApiError(err, ""));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <PageShell
      title={t(messages.title)}
      description={t(messages.description)}
      breadcrumbs={adminPageBreadcrumbs("production-readiness").map((breadcrumb) => ({
        ...breadcrumb,
        label: t(breadcrumb.to === "/admin" ? messages.adminWorkspace : messages.title),
      }))}
      actions={[
        {
          label: t(loading ? messages.refreshing : messages.refresh),
          onClick: () => void load(),
          variant: "secondary",
          disabled: loading,
        },
      ]}
      inlineContent={
        report ? <UiBadge tone={levelTone[report.status]}>{t(statusLabel(report.status))}</UiBadge> : undefined
      }
    >
      {error !== null ? <PageBanner tone="error">{error || t(messages.evaluationError)}</PageBanner> : null}
      {!report && loading ? <PageBanner tone="info">{t(messages.evaluating)}</PageBanner> : null}

      {report ? (
        <>
          <PageBanner tone={statusBannerTone(report.status)}>
            {t(messages.reportDescription)}
          </PageBanner>

          <UiCard
            title={t(messages.overview)}
            description={t(messages.overviewDescription)}
          >
            <InlineSummary
              items={[
                { label: t(messages.environment), value: report.environment },
                { label: t(messages.profile), value: report.profile },
                { label: t(messages.overall), value: t(statusLabel(report.status)) },
              ]}
            />
            <div className="mt-3">
              <ReadinessLevelOverview report={report} />
            </div>
          </UiCard>

          <UiCard
            title={t(messages.deploymentChecks)}
            description={t(messages.deploymentChecksDescription)}
            bodyClassName="p-0"
          >
            <div className="divide-y divide-[color:var(--ui-border-soft)]">
              {groupOrder.map((level) => {
                const findings = report.findings.filter((finding) => finding.level === level);
                if (findings.length === 0) return null;
                const sectionId = "production-readiness-" + level;
                return (
                  <section key={level} aria-labelledby={sectionId}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                      <h3 id={sectionId}>
                        <UiBadge tone={levelTone[level]}>
                          {t(levelLabel[level])} · {findings.length}
                        </UiBadge>
                      </h3>
                      <p className={cx("ui-caption leading-5", uiMutedTextClass)}>
                        {t(groupDescription[level])}
                      </p>
                    </div>
                    {level === "ok" ? (
                      <UiDetails className="border-t border-[color:var(--ui-border-soft)]">
                        <summary className="ui-list-control mx-4 my-2 w-fit cursor-pointer rounded-md px-2 py-1 ui-caption font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus-ring)] dark:text-primary-200">
                          {t(findings.length === 1 ? messages.showSuccessfulCheck : messages.showSuccessfulChecks)
                            .replace("{count}", String(findings.length))}
                        </summary>
                        <FindingRows findings={findings} />
                      </UiDetails>
                    ) : (
                      <FindingRows findings={findings} />
                    )}
                  </section>
                );
              })}
            </div>
          </UiCard>
        </>
      ) : null}
    </PageShell>
  );
}
