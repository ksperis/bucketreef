/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrafficSeriesPoint, TrafficWindow } from "../api/stats";
import { formatBytes, formatBytesAxis } from "../utils/format";
import { formatChartTooltipTimestamp, type ChartTooltipProps } from "./chartTooltip";
import { buildTrafficTimeline, trafficTimelineDomain } from "./trafficTimeline";

type TrafficBytesChartProps = {
  window: TrafficWindow;
  series: TrafficSeriesPoint[];
  start?: string | null;
  end?: string | null;
  height?: number;
  chartKey?: string;
  ingressLabel?: string;
  egressLabel?: string;
};

function formatXAxisTimestamp(value: string | number, window: TrafficWindow) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const options: Intl.DateTimeFormatOptions =
    window === "week" || window === "month"
      ? { day: "2-digit", month: "short" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

type TrafficTooltipProps = ChartTooltipProps & { window: TrafficWindow };

function TrafficTooltip({ payload, label, window }: TrafficTooltipProps) {
  if (!payload?.length) return null;
  const formatted = formatChartTooltipTimestamp(
    label,
    window === "week" || window === "month" ? "daily" : "hourly",
  );
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <p className="font-semibold">{formatted}</p>
      {payload.map((entry, index) => (
        <p key={entry.dataKey ?? entry.name ?? index} className="ui-caption">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {String(entry.name ?? "")}: {formatBytes(Number(entry.value) || 0)}
        </p>
      ))}
    </div>
  );
}

export default function TrafficBytesChart({
  window,
  series,
  start,
  end,
  height = 280,
  chartKey,
  ingressLabel = "Ingress",
  egressLabel = "Egress",
}: TrafficBytesChartProps) {
  const chartData = useMemo(() => buildTrafficTimeline(window, series, start, end), [end, series, start, window]);
  const domain = useMemo(() => trafficTimelineDomain(window, chartData), [chartData, window]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} key={chartKey ?? `${start ?? ""}-${end ?? ""}-${window}`}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis
          dataKey="timestampMs"
          type="number"
          domain={domain ?? ["auto", "auto"]}
          scale="time"
          tickFormatter={(value) => formatXAxisTimestamp(value, window)}
          stroke="#94A3B8"
          minTickGap={32}
        />
        <YAxis tickFormatter={(value) => formatBytesAxis(Number(value) || 0)} stroke="#94A3B8" />
        <Tooltip content={<TrafficTooltip window={window} />} />
        <Legend />
        <Bar dataKey="bytes_in" name={ingressLabel} stackId="traffic" fill="#0EA5E9" />
        <Bar dataKey="bytes_out" name={egressLabel} stackId="traffic" fill="#4F46E5" />
      </BarChart>
    </ResponsiveContainer>
  );
}
