/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCostSubjectDetail, type CostCoverage, type CostSubjectDetail } from "../../api/cost";
import { ListActionLink } from "../../components/list/ListControls";
import InlineSummary from "../../components/InlineSummary";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminI18n } from "./adminI18n";

function formatCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
  intlLocale: string,
): string {
  if (value === undefined || value === null) return "-";
  const code = currency || "EUR";
  return `${new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${code}`;
}

function formatCoverage(
  coverage: CostCoverage | null | undefined,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  if (!coverage) return "-";
  return text("{percent}% ({collected}/{total} days)", {
    percent: Math.round(coverage.coverage_ratio * 100),
    collected: coverage.days_collected,
    total: coverage.days_in_month,
  });
}

function formatCoverageBreakdown(
  coverage: CostCoverage | null | undefined,
  text: ReturnType<typeof useAdminI18n>["text"],
): string {
  if (!coverage) return text("Coverage unavailable");
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return text("Storage {storage}d · Usage {usage}d", { storage: storageDays, usage: usageDays });
}

function hasPartialCostSources(coverage?: CostCoverage | null): boolean {
  if (!coverage) return false;
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return storageDays !== usageDays;
}

function isLowCoverage(coverage?: CostCoverage | null): boolean {
  return Boolean(coverage && coverage.days_collected > 0 && coverage.coverage_ratio < 0.8);
}

export default function CostSubjectDetailPage() {
  const { intlLocale, text: adminText } = useAdminI18n();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const subjectId = Number(params.subjectId ?? "");
  const subjectType = params.subjectType === "account" || params.subjectType === "s3_user" ? params.subjectType : null;
  const endpointId = Number(searchParams.get("endpoint_id") ?? "");
  const month = searchParams.get("month") ?? "";
  const returnCandidate = searchParams.get("return_to") ?? "/admin/cost";
  const returnTo = returnCandidate.startsWith("/admin/cost") ? returnCandidate : "/admin/cost";
  const validRequest =
    Boolean(subjectType) &&
    Number.isInteger(subjectId) &&
    subjectId > 0 &&
    Number.isInteger(endpointId) &&
    endpointId > 0 &&
    /^\d{4}-\d{2}$/.test(month);

  const [detail, setDetail] = useState<CostSubjectDetail | null>(null);
  const [loading, setLoading] = useState(validRequest);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!validRequest || !subjectType) {
      setLoading(false);
      setDetail(null);
      return;
    }
    const resolvedSubjectType = subjectType;
    let cancelled = false;
    async function loadDetail() {
      setLoading(true);
      setError(null);
      try {
        const data = await getCostSubjectDetail(month, endpointId, resolvedSubjectType, subjectId);
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) {
          setDetail(null);
          setError(extractApiError(err, adminText("Unable to load cost detail.")));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [adminText, endpointId, month, subjectId, subjectType, validRequest]);

  const dailySeries = useMemo(
    () =>
      (detail?.daily ?? []).map((point) => ({
        ...point,
        label: point.day.slice(5),
        traffic_bytes: (point.bytes_in ?? 0) + (point.bytes_out ?? 0),
      })),
    [detail],
  );

  const summaryItems = useMemo(
    () => [
      {
        label: adminText("Avg storage"),
        value: detail ? formatBytes(detail.storage.avg_bytes) : "-",
      },
      {
        label: adminText("Egress"),
        value: detail ? formatBytes(detail.usage.bytes_out) : "-",
      },
      {
        label: adminText("Ingress"),
        value: detail ? formatBytes(detail.usage.bytes_in) : "-",
      },
      {
        label: adminText("Requests"),
        value: detail ? formatCompactNumber(detail.usage.ops_total) : "-",
      },
      {
        label: adminText("Estimated cost"),
        value:
          detail?.cost?.total_cost != null
            ? formatCurrency(detail.cost.total_cost, detail.cost.currency, intlLocale)
            : "-",
      },
      {
        label: adminText("Coverage"),
        value: formatCoverage(detail?.coverage, adminText),
        hint: formatCoverageBreakdown(detail?.coverage, adminText),
      },
    ],
    [adminText, detail, intlLocale],
  );

  const breadcrumbs = adminPageBreadcrumbs("cost", {
    label: detail?.name ?? adminText("Subject detail"),
  });

  return (
    <PageShell
      title={detail?.name ?? adminText("Subject detail")}
      description={adminText("Daily storage, traffic, requests, coverage, and cost for one subject.")}
      breadcrumbs={breadcrumbs}
      rightContent={
        <ListActionLink to={returnTo} variant="secondary">
          {adminText("Back to Cost")}
        </ListActionLink>
      }
    >
      {!validRequest ? (
        <PageBanner tone="error">
          {adminText("This Cost detail URL is incomplete. A valid month, endpoint, subject type, and subject ID are required.")}
        </PageBanner>
      ) : null}
      {loading ? <PageBanner tone="info">{adminText("Loading detail...")}</PageBanner> : null}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}

      {!loading && detail ? (
        <div className="space-y-4">
          {isLowCoverage(detail.coverage) ? (
            <PageBanner tone="warning">
              {adminText("Cost coverage is partial for this subject: {coverage}. Treat estimated cost as provisional.", {
                coverage: formatCoverage(detail.coverage, adminText),
              })}
            </PageBanner>
          ) : null}
          {hasPartialCostSources(detail.coverage) ? (
            <PageBanner tone="warning">
              {adminText("This subject has partial source coverage: {coverage}.", {
                coverage: formatCoverageBreakdown(detail.coverage, adminText),
              })}
            </PageBanner>
          ) : null}
          {!detail.cost ? (
            <PageBanner tone="warning">
              {adminText("No cost model is configured, so estimated cost is unavailable.")}
            </PageBanner>
          ) : null}

          <InlineSummary
            label={`${detail.storage_endpoint_name} · ${detail.month} · ${detail.subject_type === "account" ? adminText("RGW Account") : adminText("RGW User")}`}
            items={summaryItems}
          />

          <section className="ui-surface-card p-4">
            <div>
              <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Daily activity")}</h2>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {detail.rgw_identifier
                  ? adminText("RGW identifier: {identifier}", { identifier: detail.rgw_identifier })
                  : adminText("No RGW identifier")}
              </p>
            </div>

            {dailySeries.length > 0 ? (
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <div className={cx(uiCardMutedClass, "p-3")}>
                  <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Storage (daily)")}</h3>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => formatBytes(Number(value) || 0)}
                          domain={["dataMin", "dataMax"]}
                        />
                        <Tooltip formatter={(value) => formatBytes(Number(value))} />
                        <Area type="monotone" dataKey="storage_bytes" stroke="#2563eb" fill="#93c5fd" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={cx(uiCardMutedClass, "p-3")}>
                  <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Traffic (daily)")}</h3>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} />
                        <Tooltip formatter={(value) => formatBytes(Number(value))} />
                        <Bar dataKey="traffic_bytes" fill="#0ea5e9" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={cx(uiCardMutedClass, "p-3")}>
                  <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Requests (daily)")}</h3>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} />
                        <Tooltip formatter={(value) => formatCompactNumber(Number(value))} />
                        <Bar dataKey="ops_total" fill="#16a34a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : (
              <PageBanner tone="info" className="mt-4">
                {adminText("No daily cost points are available for this subject and month.")}
              </PageBanner>
            )}
          </section>
        </div>
      ) : null}
    </PageShell>
  );
}
