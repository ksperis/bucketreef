/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import { cx, uiMutedTextClass, uiTitleTextClass } from "./ui/styles";

type InlineSummaryProps = {
  label?: ReactNode;
  items: ReadonlyArray<{ label: string; value: ReactNode; hint?: ReactNode }>;
};

/** Small operational summary, without individual cards or repeated context controls. */
export default function InlineSummary({ label, items }: InlineSummaryProps) {
  return (
    <div className="space-y-1 ui-caption leading-5">
      {label ? <p className={uiMutedTextClass}>{label}</p> : null}
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <dt className={uiMutedTextClass}>{item.label}</dt>
            <dd className={cx("font-medium", uiTitleTextClass)}>
              {item.value ?? "—"}
              {item.hint ? <span className={cx("block font-normal", uiMutedTextClass)}>{item.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
