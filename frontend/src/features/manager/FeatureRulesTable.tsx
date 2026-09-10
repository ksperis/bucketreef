/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListBadge, ListActionButton } from "../../components/list/ListControls";
import { Link } from "react-router-dom";

import type {
  FeatureRuleFeature,
  FeatureRuleInventoryBucket,
  FeatureRuleInventoryRule,
  FeatureRuleInventoryStatus,
} from "../../api/managerBuckets";
import type { ListTableStatus } from "../../components/list/listTableStatus";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import TableEmptyState from "../../components/TableEmptyState";

type FeatureRulesTableProps = {
  emptyMessage: string;
  emptyRulesLabel: string;
  errorMessage: string;
  feature: FeatureRuleFeature;
  featureLabel: string;
  items: FeatureRuleInventoryBucket[];
  itemLabel: string;
  loadingMessage: string;
  onOpenRule: (bucketName: string, rule: FeatureRuleInventoryRule) => void;
  readErrorFallback: string;
  status: ListTableStatus;
};

const statusTone: Record<FeatureRuleInventoryStatus, "active" | "inactive" | "unknown"> = {
  configured: "active",
  empty: "inactive",
  unavailable: "unknown",
};

const statusLabel: Record<FeatureRuleInventoryStatus, string> = {
  configured: "Configured",
  empty: "No rules",
  unavailable: "Unavailable",
};

const primaryCellClass = "ui-table-primary";
const cellClass = "ui-table-secondary";
const wideCellClass = "ui-table-wide ui-table-secondary";
const actionCellClass = "ui-table-actions-cell text-right";
const mutedCellClass = "ui-table-secondary";
const errorCellClass = "ui-table-error";
const mutedRowClass = "ui-table-expanded";

export default function FeatureRulesTable({
  emptyMessage,
  emptyRulesLabel,
  errorMessage,
  feature,
  featureLabel,
  items,
  itemLabel,
  loadingMessage,
  onOpenRule,
  readErrorFallback,
  status,
}: FeatureRulesTableProps) {
  const columns = [
    { id: "bucket", label: "Bucket", align: "left" },
    { id: "status", label: "Status", align: "left" },
    { id: "rule", label: feature === "tags" ? "Tag" : "Rule", align: "left" },
    { id: "summary", label: feature === "tags" ? "Value" : "Summary", align: "left" },
    { id: "json", label: "JSON", align: "right" },
  ] as const;

  return (
    <div className="overflow-x-auto">
      <table className="ui-data-table ui-data-table-fixed min-w-full divide-y divide-slate-200 dark:divide-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={column.align === "right" ? "text-right" : "text-left"}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {status === "loading" && <TableEmptyState colSpan={columns.length} message={loadingMessage} />}
          {status === "error" && <TableEmptyState colSpan={columns.length} message={errorMessage} tone="error" />}
          {status === "empty" && <TableEmptyState colSpan={columns.length} message={emptyMessage} />}
          {items.flatMap((item) => {
            const bucketRow = (
              <tr key={`${item.bucket_name}:bucket`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className={primaryCellClass}>
                  <Link
                    to={`/manager/buckets/${encodeURIComponent(item.bucket_name)}`}
                    className="hover:text-primary-700 dark:hover:text-primary-200"
                  >
                    {item.bucket_name}
                  </Link>
                </td>
                <td className={cellClass}>
                  <PropertySummaryChip compact state={statusLabel[item.status]} tone={statusTone[item.status]} />
                </td>
                <td className={mutedCellClass}>{item.rules.length > 0 ? `${item.rules.length} ${itemLabel}` : "-"}</td>
                <td className={mutedCellClass}>
                  {item.status === "unavailable" ? item.error || readErrorFallback : featureLabel}
                </td>
                <td className={actionCellClass} />
              </tr>
            );

            if (item.status === "empty") {
              return [
                bucketRow,
                <tr key={`${item.bucket_name}:empty`} className={mutedRowClass}>
                  <td className={mutedCellClass} />
                  <td className={mutedCellClass} />
                  <td colSpan={3} className={mutedCellClass}>
                    {emptyRulesLabel}
                  </td>
                </tr>,
              ];
            }

            if (item.status === "unavailable") {
              return [
                bucketRow,
                <tr key={`${item.bucket_name}:unavailable`} className={mutedRowClass}>
                  <td className={mutedCellClass} />
                  <td className={mutedCellClass} />
                  <td colSpan={3} className={errorCellClass}>
                    {item.error || readErrorFallback}
                  </td>
                </tr>,
              ];
            }

            return [
              bucketRow,
              ...item.rules.map((rule) => (
                <tr key={`${item.bucket_name}:${rule.type}:${rule.id}`} className={mutedRowClass}>
                  <td className={mutedCellClass} />
                  <td className={mutedCellClass} />
                  <td className={`${cellClass} max-w-xs ui-table-primary`}>
                    <div className="truncate" title={rule.title}>
                      {rule.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {rule.chips.slice(0, 3).map((chip) => (
                        <ListBadge
                          key={chip}
                          tone="neutral" className="max-w-[12rem] truncate"
                          title={chip}
                        >
                          {chip}
                        </ListBadge>
                      ))}
                    </div>
                  </td>
                  <td className={`${wideCellClass} max-w-2xl`}>
                    <div className="truncate" title={rule.summary}>
                      {rule.summary}
                    </div>
                  </td>
                  <td className={actionCellClass}>
                    <ListActionButton
                      type="button"
                      onClick={() => onOpenRule(item.bucket_name, rule)}
                    >
                      JSON
                    </ListActionButton>
                  </td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
