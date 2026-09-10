/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, useLayoutEffect, useRef, useState } from "react";
import ColumnVisibilityPicker, { type ColumnVisibilityPickerProps } from "./ColumnVisibilityPicker";
import { ListActionButton } from "./list/ListControls";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { cx, uiMenuClass } from "./ui/styles";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";
import "./columnVisibilityMenu.css";

export default function ColumnVisibilityMenu<Id extends string>(props: Omit<ColumnVisibilityPickerProps<Id>, "onClose">) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const closeAndRestoreFocus = () => {
    setOpen(false);
    anchorRef.current?.focus({ preventScroll: true });
  };

  useDismissibleLayer({
    open,
    insideRefs: [anchorRef, panelRef],
    dismissOnFocusOutside: true,
    preventEscapeDefault: true,
    onDismiss: (reason) => {
      if (reason === "escape") closeAndRestoreFocus();
      else setOpen(false);
    },
  });

  useLayoutEffect(() => {
    if (!open) return;
    const firstControl = panelRef.current?.querySelector<HTMLElement>('input:not(:disabled)')
      ?? panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
    (firstControl ?? panelRef.current)?.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      <ListActionButton
        ref={anchorRef}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
      >
        Columns
      </ListActionButton>
      <AnchoredPortalMenu open={open} anchorRef={anchorRef} placement="bottom-end" minWidth={0}>
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={props.title ?? "Visible columns"}
          tabIndex={-1}
          className={cx(uiMenuClass, "ui-column-menu")}
        >
          <ColumnVisibilityPicker {...props} onClose={closeAndRestoreFocus} />
        </div>
      </AnchoredPortalMenu>
    </>
  );
}
