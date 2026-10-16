/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import InlineSummary from "../../components/InlineSummary";
import UiDetails from "../../components/ui/UiDetails";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { cx, uiDividerClass, uiMutedTextClass } from "../../components/ui/styles";
import { ChevronDownIcon } from "../browser/browserIcons";
import { formatNumber } from "../../utils/format";
import "./bucketOperationRun.css";
import { useSharedI18n } from "./sharedI18n";

type BucketOperationResultProps = {
  bucketName: string;
  contextLabel?: string | null;
  status: ReactNode;
  durationSeconds: number;
  metrics: ReadonlyArray<{ label: string; value: ReactNode }>;
  children: ReactNode;
};

function formatSeconds(value?: number | null): string {
  if (value === undefined || value === null) return "-";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(value >= 10 ? 0 : 1)} s`;
}

/** Native disclosure keeps keyboard behavior and the bucket's open state together. */
export default function BucketOperationResult({
  bucketName, contextLabel, status, durationSeconds, metrics, children,
}: BucketOperationResultProps) {
  const { text: surfaceText } = useSharedI18n();
  return (
    <UiDetails className="bucket-operation-result">
      <summary>
        <ChevronDownIcon aria-hidden="true" className="bucket-operation-result-chevron" />
        <div className="bucket-operation-result-summary">
          <div className="bucket-operation-result-identity">
            <p className="break-all font-medium text-[var(--ui-text)]">{bucketName}</p>
            {contextLabel ? <p className={cx("break-all", uiMutedTextClass)}>{contextLabel}</p> : null}
          </div>
          {status}
          <InlineSummary items={[
            ...metrics,
            { label: surfaceText("Duration"), value: formatSeconds(durationSeconds) },
          ]} />
        </div>
      </summary>
      <div className={cx("min-w-0 space-y-2 border-t px-3 py-3", uiDividerClass)}>{children}</div>
    </UiDetails>
  );
}

type BucketOperationFailureRow = {
  stage: string;
  target: string;
  version?: string | null;
  count?: number;
  message: string;
};

export function BucketOperationFailures({
  bucketName, title, targetLabel, total, failures, showCount = false, emptyMessage,
}: {
  bucketName: string;
  title: string;
  targetLabel: string;
  total: number;
  failures: readonly BucketOperationFailureRow[];
  showCount?: boolean;
  emptyMessage: string;
}) {
  const { text: surfaceText } = useSharedI18n();
  const tableLabel = `${title}: ${bucketName}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 ui-caption">
        <p className="font-medium text-[var(--ui-text)]">{title}</p>
        <p className={uiMutedTextClass}>
          {surfaceText(
            total === 1
              ? "{visible} visible / {total} total error"
              : "{visible} visible / {total} total errors",
            { visible: formatNumber(failures.length), total: formatNumber(total) },
          )}</p>
      </div>
      {total > failures.length ? (
        <UiInlineMessage tone="warning">
          {surfaceText(
            total === 1
              ? "Only {visible} of {total} error is visible."
              : "Only {visible} of {total} errors are visible.",
            { visible: formatNumber(failures.length), total: formatNumber(total) },
          )}</UiInlineMessage>
      ) : null}
      {failures.length > 0 ? (
        <div className="bucket-operation-failures" role="region" aria-label={tableLabel} tabIndex={0}>
          <table className="ui-data-table" aria-label={tableLabel}>
            <thead>
              <tr>
                <th scope="col">{surfaceText("Stage")}</th>
                <th scope="col">{targetLabel}</th>
                <th scope="col">{surfaceText("Version")}</th>
                {showCount ? <th scope="col">{surfaceText("Count")}</th> : null}
                <th scope="col">{surfaceText("Message")}</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((failure, index) => (
                <tr key={`${failure.stage}:${failure.target}:${failure.version ?? ""}:${index}`}>
                  <td className="whitespace-nowrap ui-table-primary">{failure.stage}</td>
                  <td className="min-w-[12rem] break-all font-mono">{failure.target}</td>
                  <td className="min-w-[10rem] break-all font-mono ui-table-secondary">{failure.version || "-"}</td>
                  {showCount ? <td>{failure.count == null ? "-" : formatNumber(failure.count)}</td> : null}
                  <td className="min-w-[18rem] break-words">{failure.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <UiInlineMessage>
          {total > 0 ? surfaceText("Error details are unavailable for this bucket.") : emptyMessage}
        </UiInlineMessage>
      )}
    </>
  );
}
