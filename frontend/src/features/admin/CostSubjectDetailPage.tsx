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
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCostSubjectDetail, type AdminCostSubjectDetail, type CostCoverage } from "../../api/cost";
import { ListActionLink } from "../../components/list/ListControls";
import InlineSummary from "../../components/InlineSummary";
import { MetricsLegendList } from "../../components/MetricsCard";
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

const COMPONENT_COLORS = ["#2563eb", "#f97316", "#14b8a6", "#8b5cf6"];
const CHART_AXIS_COLOR = "#94A3B8";
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--ui-surface)",
  borderColor: "var(--ui-border)",
  color: "var(--ui-text)",
};

function signedCurrency(value: number, currency: string | null | undefined, intlLocale: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(value), currency, intlLocale)}`;
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

  const [detail, setDetail] = useState<AdminCostSubjectDetail | null>(null);
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
      })),
    [detail],
  );

  const costBreakdown = useMemo(() => {
    const cost = detail?.cost;
    if (!cost) return [];
    const entries = [
      { name: adminText("Storage"), value: cost.storage_cost ?? 0 },
      { name: adminText("Egress"), value: cost.egress_cost ?? 0 },
      { name: adminText("Ingress"), value: cost.ingress_cost ?? 0 },
      { name: adminText("Requests"), value: cost.requests_cost ?? 0 },
    ];
    const total = cost.total_cost ?? entries.reduce((sum, entry) => sum + entry.value, 0);
    return entries
      .filter((entry) => entry.value > 0)
      .map((entry) => ({ ...entry, share: total > 0 ? entry.value / total : 0 }));
  }, [adminText, detail]);

  const requestBreakdown = useMemo(() => {
    const entries = Object.entries(detail?.usage.ops_breakdown ?? {}).sort((left, right) => right[1] - left[1]);
    if (entries.length <= 8) return entries.map(([name, value]) => ({ name, value }));
    const visible = entries.slice(0, 7).map(([name, value]) => ({ name, value }));
    visible.push({
      name: adminText("Other"),
      value: entries.slice(7).reduce((sum, [, value]) => sum + value, 0),
    });
    return visible;
  }, [adminText, detail]);

  const historySeries = useMemo(
    () =>
      (detail?.history ?? []).map((point) => {
        const hasData = point.coverage.days_collected > 0;
        return {
          month: point.month.slice(2),
          storage: hasData ? (point.cost?.storage_cost ?? null) : null,
          egress: hasData ? (point.cost?.egress_cost ?? null) : null,
          ingress: hasData ? (point.cost?.ingress_cost ?? null) : null,
          requests: hasData ? (point.cost?.requests_cost ?? null) : null,
          total: hasData ? (point.cost?.total_cost ?? null) : null,
        };
      }),
    [detail],
  );

  const previousMonthComparison = useMemo(() => {
    if (
      !detail ||
      detail.coverage.days_collected <= 0 ||
      detail.history.length < 2 ||
      detail.cost?.total_cost == null
    ) return null;
    const previous = detail.history[detail.history.length - 2];
    if (previous.coverage.days_collected <= 0 || previous.cost?.total_cost == null) return null;
    const current = detail.cost.total_cost;
    const previousTotal = previous.cost.total_cost;
    const delta = current - previousTotal;
    return {
      month: previous.month,
      delta,
      percent: previousTotal !== 0 ? delta / previousTotal : null,
    };
  }, [detail]);

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
        label: adminText("Cost change"),
        value:
          previousMonthComparison?.percent != null
            ? `${previousMonthComparison.percent > 0 ? "+" : ""}${new Intl.NumberFormat(intlLocale, {
                style: "percent",
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(previousMonthComparison.percent)}`
            : "-",
        hint: previousMonthComparison
          ? adminText("{delta} vs {month}", {
              delta: signedCurrency(previousMonthComparison.delta, detail?.cost?.currency, intlLocale),
              month: previousMonthComparison.month,
            })
          : adminText("No comparable previous-month data"),
      },
      {
        label: adminText("Coverage"),
        value: formatCoverage(detail?.coverage, adminText),
        hint: formatCoverageBreakdown(detail?.coverage, adminText),
      },
    ],
    [adminText, detail, intlLocale, previousMonthComparison],
  );

  const breadcrumbs = adminPageBreadcrumbs("cost", {
    label: detail?.name ?? adminText("Subject detail"),
  });

  return (
    <PageShell
      title={detail?.name ?? adminText("Subject detail")}
      description={adminText("Cost drivers, historical trend, and daily activity for one subject.")}
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

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="ui-surface-card p-4">
              <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Cost breakdown")}</h2>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {adminText("Contribution of storage, transfer, and requests to this month's estimated cost.")}
              </p>
              {costBreakdown.length > 0 ? (
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)] md:items-center">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={costBreakdown} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="78%">
                          {costBreakdown.map((entry, index) => (
                            <Cell key={entry.name} fill={COMPONENT_COLORS[index % COMPONENT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          formatter={(value) => formatCurrency(Number(value), detail.cost?.currency, intlLocale)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <MetricsLegendList
                    items={costBreakdown.map((entry, index) => ({
                      key: entry.name,
                      label: entry.name,
                      color: COMPONENT_COLORS[index % COMPONENT_COLORS.length],
                      value: formatCurrency(entry.value, detail.cost?.currency, intlLocale),
                      meta: new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 }).format(entry.share),
                    }))}
                  />
                </div>
              ) : (
                <PageBanner tone="info" className="mt-3">{adminText("No component cost data is available for this month.")}</PageBanner>
              )}
            </section>

            <section className="ui-surface-card p-4">
              <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("Request activity")}</h2>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {adminText("RGW request categories collected for this subject during the selected month.")}
              </p>
              {requestBreakdown.length > 0 ? (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={requestBreakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis
                        type="number"
                        stroke={CHART_AXIS_COLOR}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => formatCompactNumber(Number(value) || 0)}
                      />
                      <YAxis dataKey="name" type="category" width={110} stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => formatCompactNumber(Number(value))} />
                      <Bar dataKey="value" name={adminText("Requests")} fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <PageBanner tone="info" className="mt-3">{adminText("No request-category breakdown is available for this month.")}</PageBanner>
              )}
            </section>
          </div>

          <section className="ui-surface-card p-4">
            <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>{adminText("12-month cost trend")}</h2>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {adminText("Monthly component costs for this subject ending with the selected month.")}
            </p>
            {historySeries.some((point) => point.total != null) ? (
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historySeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} />
                    <YAxis stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(value) => formatCurrency(Number(value), detail.cost?.currency, intlLocale)}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="storage" name={adminText("Storage")} stackId="cost" fill="#2563eb" stroke="#2563eb" connectNulls={false} />
                    <Area type="monotone" dataKey="egress" name={adminText("Egress")} stackId="cost" fill="#f97316" stroke="#f97316" connectNulls={false} />
                    <Area type="monotone" dataKey="ingress" name={adminText("Ingress")} stackId="cost" fill="#14b8a6" stroke="#14b8a6" connectNulls={false} />
                    <Area type="monotone" dataKey="requests" name={adminText("Requests")} stackId="cost" fill="#8b5cf6" stroke="#8b5cf6" connectNulls={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <PageBanner tone="info" className="mt-3">{adminText("No historical cost data is available for this subject.")}</PageBanner>
            )}
          </section>

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
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} />
                        <YAxis
                          stroke={CHART_AXIS_COLOR}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => formatBytes(Number(value) || 0)}
                          domain={["dataMin", "dataMax"]}
                        />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => formatBytes(Number(value))} />
                        <Area type="monotone" dataKey="storage_bytes" stroke="#2563eb" fill="#93c5fd" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={cx(uiCardMutedClass, "p-3")}>
                  <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Ingress / Egress (daily)")}</h3>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} />
                        <YAxis stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => formatBytes(Number(value))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="bytes_out" name={adminText("Egress")} fill="#f97316" />
                        <Bar dataKey="bytes_in" name={adminText("Ingress")} fill="#14b8a6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={cx(uiCardMutedClass, "p-3")}>
                  <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>{adminText("Requests (daily)")}</h3>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} />
                        <YAxis stroke={CHART_AXIS_COLOR} tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => formatCompactNumber(Number(value))} />
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
