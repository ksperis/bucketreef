/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminEntityMetrics } from "../../api/cephAdminMetrics";
import type { CephAdminRgwQuotaConfig } from "../../api/cephAdminRgwTypes";
import DataTableShell from "../../components/list/DataTableShell";
import PageBanner from "../../components/PageBanner";
import UsageTile from "../../components/UsageTile";
import { cx, uiPanelMutedClass } from "../../components/ui/styles";
import { formatBytes, formatNumber } from "../../utils/format";
import { useCephAdminI18n } from "./cephAdminI18n";

type Props = {
  error: string | null;
  loading: boolean;
  metrics: CephAdminEntityMetrics | null;
  quota: CephAdminRgwQuotaConfig | null | undefined;
};

export default function CephAdminEntityMetricsPanel({
  error,
  loading,
  metrics,
  quota,
}: Props) {
  const { text: surfaceText } = useCephAdminI18n();

  return (
    <section className="space-y-4">
      {loading && <PageBanner tone="info">{surfaceText("Loading metrics...")}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {metrics && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label={surfaceText("Storage")}
              used={metrics.total_bytes ?? null}
              quota={quota?.max_size_bytes ?? null}
              formatter={formatBytes}
              quotaFormatter={formatBytes}
              emptyHint={surfaceText("No storage quota defined.")}
            />
            <UsageTile
              label={surfaceText("Objects")}
              used={metrics.total_objects ?? null}
              quota={quota?.max_objects ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint={surfaceText("objects")}
              emptyHint={surfaceText("No object quota defined.")}
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <div className="flex items-center justify-between gap-2">
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                {surfaceText("Top buckets by usage")}
              </p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {surfaceText(metrics.bucket_count === 1 ? "{count} bucket" : "{count} buckets", {
                  count: metrics.bucket_count,
                })}
              </p>
            </div>
            <DataTableShell
              columns={[
                {
                  id: "bucket",
                  label: surfaceText("Bucket"),
                  primary: true,
                  render: (entry) => entry.name,
                },
                {
                  id: "used",
                  label: surfaceText("Used"),
                  align: "right",
                  render: (entry) => formatBytes(entry.used_bytes),
                },
                {
                  id: "objects",
                  label: surfaceText("Objects"),
                  align: "right",
                  render: (entry) => formatNumber(entry.object_count),
                },
              ]}
              rows={metrics.bucket_usage.slice(0, 50)}
              rowKey={(entry) => entry.name}
              status={metrics.bucket_usage.length > 0 ? "ready" : "empty"}
              loadingMessage={surfaceText("Loading bucket usage...")}
              errorMessage={surfaceText("Unable to load bucket usage.")}
              emptyMessage={surfaceText("No bucket usage data available.")}
              primaryColumnId="bucket"
              containerClassName="mt-3"
            />
          </div>
        </>
      )}
    </section>
  );
}
