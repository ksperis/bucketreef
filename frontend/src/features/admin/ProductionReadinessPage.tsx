/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import {
  fetchProductionReadiness,
  type HardeningLevel,
  type ProductionReadinessResponse,
} from "../../api/productionReadiness";
import InlineSummary from "../../components/InlineSummary";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import { uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

const levelTone: Record<HardeningLevel, "success" | "warning" | "danger"> = {
  pass: "success",
  warning: "warning",
  fail: "danger",
};

const levelLabel: Record<HardeningLevel, string> = {
  pass: "Pass",
  warning: "Warning",
  fail: "Fail",
};

function statusBannerTone(status: HardeningLevel): "success" | "warning" | "error" {
  if (status === "pass") return "success";
  if (status === "warning") return "warning";
  return "error";
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
      description="Configuration hardening checks for this backend runtime."
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
        report ? <UiBadge tone={levelTone[report.status]}>{levelLabel[report.status]}</UiBadge> : undefined
      }
    >
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {!report && loading ? <PageBanner tone="info">Evaluating this backend runtime…</PageBanner> : null}

      {report ? (
        <>
          <PageBanner tone={statusBannerTone(report.status)}>
            This report evaluates only this backend instance using the <strong>{report.profile}</strong> deployment profile.
            It does not certify other split instances or manual operational gates such as backup restore, network exposure,
            observability, and support readiness.
          </PageBanner>

          <UiCard title="Runtime summary" description="Current configuration hardening result for this instance.">
            <InlineSummary
              items={[
                { label: "Profile", value: report.profile },
                { label: "Overall", value: levelLabel[report.status] },
                { label: "Passed", value: report.counts.pass },
                { label: "Warnings", value: report.counts.warning },
                { label: "Failures", value: report.counts.fail },
              ]}
            />
          </UiCard>

          <UiCard
            title="Hardening checks"
            description="Read-only checks derived from the effective backend runtime configuration."
            bodyClassName="p-0"
          >
            <div className="divide-y divide-[color:var(--ui-border-soft)]">
              {report.findings.map((finding) => (
                <div key={finding.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold leading-5 ${uiTitleTextClass}`}>{finding.label}</p>
                    <p className={`text-xs leading-5 ${uiMutedTextClass}`}>{finding.message}</p>
                    <p className={`mt-0.5 font-mono text-[11px] leading-4 ${uiMutedTextClass}`}>{finding.code}</p>
                  </div>
                  <UiBadge tone={levelTone[finding.level]} className="shrink-0">
                    {levelLabel[finding.level]}
                  </UiBadge>
                </div>
              ))}
            </div>
          </UiCard>
        </>
      ) : null}
    </PageShell>
  );
}
