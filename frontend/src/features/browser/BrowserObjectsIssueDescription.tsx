/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useBrowserI18n } from "./browserI18n";

type BrowserObjectsIssueDescriptionProps = {
  description: string;
  technicalDetail: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export default function BrowserObjectsIssueDescription({
  description,
  technicalDetail,
  expanded,
  onExpandedChange,
}: BrowserObjectsIssueDescriptionProps) {
  const { text } = useBrowserI18n();

  return (
    <div className="space-y-2">
      <p>{text(description)}</p>
      <details
        open={expanded}
        onToggle={(event) => onExpandedChange(event.currentTarget.open)}
        className="mx-auto max-w-xl rounded-md border border-rose-200/70 bg-rose-50/70 px-2 py-1.5 text-left dark:border-rose-500/30 dark:bg-rose-900/20"
      >
        <summary className="list-none cursor-pointer ui-caption font-semibold text-rose-700 dark:text-rose-100 [&::-webkit-details-marker]:hidden">
          {text("Show technical details")}
        </summary>
        {expanded && (
          <p className="mt-2 break-words ui-caption text-rose-700 dark:text-rose-100">
            {technicalDetail}
          </p>
        )}
      </details>
    </div>
  );
}
