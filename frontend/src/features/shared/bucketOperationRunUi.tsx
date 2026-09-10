/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

export const bucketOperationTableContainerClass =
  "max-h-96 overflow-auto rounded-md border border-slate-200 dark:border-slate-800";

type BucketOperationSummaryStatProps = {
  label: ReactNode;
  value: ReactNode;
};

export function BucketOperationSummaryStat({ label, value }: BucketOperationSummaryStatProps) {
  return (
    <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
      <p className="ui-caption text-slate-500 dark:text-slate-400">{label}</p>
      <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}
