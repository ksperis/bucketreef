/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { InfoIcon } from "../../features/browser/browserIcons";
import AnchoredPortalMenu from "./AnchoredPortalMenu";
import UiButton from "./UiButton";
import { cx, uiMenuClass } from "./styles";
import { useDismissibleLayer } from "./useDismissibleLayer";


export default function UiInfoTooltip({ label, children, triggerClassName, tooltipClassName }: { label: string; children: ReactNode; triggerClassName?: string; tooltipClassName?: string }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const focused = useRef(false);
  const hovered = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const cancelClose = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  }, [cancelClose]);
  const show = () => { cancelClose(); setOpen(true); };
  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!pinned.current && !focused.current && !hovered.current) close();
    }, 120);
  };

  useEffect(() => cancelClose, [cancelClose]);
  useDismissibleLayer({
    open,
    insideRefs: [anchor, tooltip],
    onDismiss: close,
    outsideEvent: "pointerdown",
  });

  return (
    <span ref={anchor} className="inline-flex"
      onMouseEnter={() => { hovered.current = true; show(); }}
      onMouseLeave={() => { hovered.current = false; scheduleClose(); }}
      onFocus={() => { focused.current = true; show(); }}
      onBlur={() => { focused.current = false; scheduleClose(); }}
    >
      <UiButton variant="ghost" size="xs" className={triggerClassName}
        aria-label={label} aria-describedby={open ? id : undefined}
        onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}
      >
        <InfoIcon className="h-3.5 w-3.5 text-[var(--ui-text-muted)]" />
      </UiButton>
      <AnchoredPortalMenu open={open} anchorRef={anchor} placement="bottom-start" minWidth={280} offset={4}
        className={cx(uiMenuClass, tooltipClassName)}
      >
        <div ref={tooltip} id={id} role="tooltip" aria-label={label}
          onMouseEnter={() => { hovered.current = true; show(); }}
          onMouseLeave={() => { hovered.current = false; scheduleClose(); }}
        >{children}</div>
      </AnchoredPortalMenu>
    </span>
  );
}
