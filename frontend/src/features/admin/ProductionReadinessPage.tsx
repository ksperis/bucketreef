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
import { extractApiError } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

const levelTone: Record<CheckLevel, "success" | "warning" | "danger" | "info" | "neutral"> = {
  blocked: "danger",
  critical: "danger",
  warning: "warning",
  manual: "info",
  ok: "success",
};

const levelLabel: Record<CheckLevel, string> = {
  blocked: "Blocked",
  critical: "Critical",
  warning: "Warning",
  manual: "Manual",
  ok: "OK",
};

const groupOrder: CheckLevel[] = ["blocked", "critical", "warning", "manual", "ok"];

const groupDescription: Record<CheckLevel, string> = {
  blocked: "Obvious security problems. In production, checks marked as startup-blocking prevent the backend from serving requests.",
  critical: "Important production-readiness gaps that should be corrected before publication, without preventing application startup.",
  warning: "Configuration choices that can be valid but deserve explicit operator review.",
  manual: "Operational properties that cannot be proven safely from this backend instance and require human verification.",
  ok: "Automated checks that currently satisfy their expected configuration.",
};

const levelSummary: Record<CheckLevel, string> = {
  blocked: "Can prevent startup in production.",
  critical: "Correct before production publication.",
  warning: "Review against your deployment context.",
  manual: "Requires explicit operator verification.",
  ok: "Automated checks currently satisfied.",
};

function ReadinessLevelOverview({ report }: { report: ProductionReadinessResponse }) {
  return (
    <div>
      <dl
        aria-label="Readiness levels"
        className="grid gap-px overflow-hidden rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-border-soft)] sm:grid-cols-2 lg:grid-cols-5"
      >
        {groupOrder.map((level) => (
          <div
            key={level}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 bg-[var(--ui-surface-muted)] px-3 py-3"
          >
            <dt>
              <UiBadge tone={levelTone[level]}>{levelLabel[level]}</UiBadge>
            </dt>
            <dd className={cx("text-[18px] font-semibold leading-5", uiTitleTextClass)}>
              {report.counts[level]}
            </dd>
            <dd className={cx("col-span-2 mt-2 ui-caption leading-4", uiMutedTextClass)}>
              {levelSummary[level]}
            </dd>
          </div>
        ))}
      </dl>
      <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
        All five levels remain visible, including levels with no current findings.
      </p>
    </div>
  );
}

function FindingRows({ findings }: { findings: ProductionReadinessResponse["findings"] }) {
  return (
    <div className="divide-y divide-[color:var(--ui-border-soft)] border-t border-[color:var(--ui-border-soft)]">
      {findings.map((finding) => (
        <div key={finding.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>{finding.label}</p>
            <p className={cx("ui-caption leading-5", uiMutedTextClass)}>{finding.message}</p>
            {finding.blocks_startup ? (
              <p className="mt-1 ui-caption font-medium text-[color:var(--ui-danger)]">
                Blocks application startup in the current runtime.
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
                Documentation
              </a>
            </div>
          </div>
          <UiBadge tone={levelTone[finding.level]} className="shrink-0">
            {levelLabel[finding.level]}
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

function statusLabel(status: ReadinessStatus): string {
  if (status === "blocked") return "Blocked";
  if (status === "critical") return "Critical";
  if (status === "warning") return "Warning";
  return "OK";
}

export default function ProductionReadinessPage() {
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
      setError(extractApiError(err, "Unable to evaluate production readiness."));
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
      title="Production readiness"
      description="Security, deployment and operational checks for this backend runtime."
      breadcrumbs={adminPageBreadcrumbs("production-readiness")}
      actions={[
        {
          label: loading ? "Refreshing…" : "Refresh",
          onClick: () => void load(),
          variant: "secondary",
          disabled: loading,
        },
      ]}
      inlineContent={
        report ? <UiBadge tone={levelTone[report.status]}>{statusLabel(report.status)}</UiBadge> : undefined
      }
    >
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {!report && loading ? <PageBanner tone="info">Evaluating this backend runtime…</PageBanner> : null}

      {report ? (
        <>
          <PageBanner tone={statusBannerTone(report.status)}>
            This report evaluates the production target for this backend instance. Findings marked as startup-blocking
            can prevent backend startup; critical findings remain operational so they can be corrected before
            publication.
          </PageBanner>

          <UiCard
            title="Readiness overview"
            description="The five readiness levels used by startup diagnostics, the CLI and this page."
          >
            <InlineSummary
              items={[
                { label: "Environment", value: report.environment },
                { label: "Profile", value: report.profile },
                { label: "Overall", value: statusLabel(report.status) },
              ]}
            />
            <div className="mt-3">
              <ReadinessLevelOverview report={report} />
            </div>
          </UiCard>

          <UiCard
            title="Deployment checks"
            description="Findings are grouped by readiness level. Successful checks stay collapsed by default."
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
                          {levelLabel[level]} · {findings.length}
                        </UiBadge>
                      </h3>
                      <p className={cx("ui-caption leading-5", uiMutedTextClass)}>
                        {groupDescription[level]}
                      </p>
                    </div>
                    {level === "ok" ? (
                      <UiDetails className="border-t border-[color:var(--ui-border-soft)]">
                        <summary className="ui-list-control mx-4 my-2 w-fit cursor-pointer rounded-md px-2 py-1 ui-caption font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus-ring)] dark:text-primary-200">
                          Show {findings.length} successful check{findings.length === 1 ? "" : "s"}
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
