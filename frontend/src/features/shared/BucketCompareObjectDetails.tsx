/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ListActionAnchor, ListActionButton } from "../../components/list/ListControls";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import { cx, uiMenuClass, uiMutedTextClass } from "../../components/ui/styles";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import { formatLocalDateTime } from "../../utils/dateTime";
import { formatBytes } from "../../utils/format";
import "./bucketCompareObjectDetails.css";

export type CompareObjectDetailLike = {
  key: string;
  size?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  storage_class?: string | null;
};

type CompareObjectOptions = {
  buildBrowserHref?: (detail: CompareObjectDetailLike) => string | null;
  browserDisabledReason?: string | null;
  onExplore?: (href: string, detail: CompareObjectDetailLike, index: number) => void;
  renderAction?: (detail: CompareObjectDetailLike, closeMetadata: () => void) => ReactNode;
};

function CompareObjectRow({ detail, index, options, open, onOpenChange }: {
  detail: CompareObjectDetailLike;
  index: number;
  options?: CompareObjectOptions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panelId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const href = options?.buildBrowserHref?.(detail) ?? null;
  const closeAndReturnFocus = () => {
    onOpenChange(false);
    anchorRef.current?.focus({ preventScroll: true });
  };
  const action = options?.renderAction?.(detail, closeAndReturnFocus) ?? null;

  useDismissibleLayer({
    open,
    insideRefs: [anchorRef, panelRef],
    dismissOnFocusOutside: true,
    preventEscapeDefault: true,
    onDismiss: (reason) => {
      if (reason === "escape") closeAndReturnFocus();
      else onOpenChange(false);
    },
  });

  useLayoutEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div>
      <button
        ref={anchorRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
        className="bucket-compare-object-trigger"
      >
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono">{detail.key}</span>
        <span aria-hidden="true" className="bucket-compare-object-info">i</span>
        <span className="sr-only">Show object metadata</span>
      </button>
      <AnchoredPortalMenu open={open} anchorRef={anchorRef} placement="bottom-start" minWidth={0}>
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={`Object metadata for ${detail.key}`}
          tabIndex={-1}
          className={cx(uiMenuClass, "bucket-compare-object-panel")}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
            if (event.shiftKey && (event.target === panelRef.current || event.target === controls[0])) {
              event.preventDefault();
              closeAndReturnFocus();
            } else if (!event.shiftKey && event.target === controls.at(-1)) {
              // Continue the native Tab sequence from the object's position in the result.
              closeAndReturnFocus();
            }
          }}
        >
          <div className="bucket-compare-object-header">
            <p className="font-semibold">Object metadata</p>
            <ListActionButton onClick={closeAndReturnFocus} aria-label="Close object metadata">Close</ListActionButton>
          </div>
          <p className="whitespace-pre-wrap break-all font-mono">{detail.key}</p>
          <dl className="bucket-compare-object-metadata">
            <div><dt>Size</dt><dd>{formatBytes(detail.size)}</dd></div>
            <div><dt>Modified</dt><dd>{formatLocalDateTime(detail.last_modified)}</dd></div>
            <div><dt>ETag</dt><dd className="font-mono">{detail.etag?.trim().replace(/^"|"$/g, "") || "-"}</dd></div>
            <div><dt>Storage</dt><dd>{detail.storage_class || "-"}</dd></div>
          </dl>
          {(href || options?.browserDisabledReason || action) && (
            <div className="bucket-compare-object-actions">
              <div className="flex flex-wrap gap-2">
                {options?.browserDisabledReason ? (
                  <ListActionButton disabled title={options.browserDisabledReason}>Explore</ListActionButton>
                ) : href && options?.onExplore ? (
                  <ListActionButton onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    closeAndReturnFocus();
                    options.onExplore?.(href, detail, index);
                  }}>Explore</ListActionButton>
                ) : href ? (
                  <ListActionAnchor href={href} target="_blank" rel="noreferrer" onClick={closeAndReturnFocus}>Explore</ListActionAnchor>
                ) : null}
                {action}
              </div>
              {options?.browserDisabledReason && <p className={uiMutedTextClass}>{options.browserDisabledReason}</p>}
            </div>
          )}
        </div>
      </AnchoredPortalMenu>
    </div>
  );
}

export default function BucketCompareObjectDetails({ rows, options }: {
  rows: CompareObjectDetailLike[];
  options?: CompareObjectOptions;
}) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  if (rows.length === 0) return <div className={cx("px-1 py-1 ui-caption", uiMutedTextClass)}>(none)</div>;
  return (
    <div className="divide-y divide-[color:var(--ui-border-soft)]">
      {rows.map((detail, index) => {
        const rowId = `${detail.key}-${index}`;
        return <CompareObjectRow key={rowId} detail={detail} index={index} options={options}
          open={expandedRowId === rowId} onOpenChange={(open) => setExpandedRowId(open ? rowId : null)} />;
      })}
    </div>
  );
}
