/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

import { ListActionButton } from "../list/ListControls";
import AnchoredPortalMenu, { type AnchoredMenuPlacement } from "./AnchoredPortalMenu";
import { cx, uiMenuClass, uiMutedTextClass } from "./styles";
import { useDismissibleLayer } from "./useDismissibleLayer";
import "./uiActionMenu.css";

export type UiActionMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
  danger?: boolean;
};

export type UiActionMenuSection = {
  id: string;
  label?: string;
  items: UiActionMenuItem[];
};

type UiActionMenuProps = {
  ariaLabel: string;
  trigger: ReactNode;
  triggerClassName: string;
  sections: UiActionMenuSection[];
  placement?: AnchoredMenuPlacement;
  minWidth?: number;
  menuClassName?: string;
};

const enabledMenuItemSelector = '[role="menuitem"]:not([aria-disabled="true"])';

export default function UiActionMenu({
  ariaLabel,
  trigger,
  triggerClassName,
  sections,
  placement = "bottom-end",
  minWidth = 240,
  menuClassName,
}: UiActionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const closeAndReturnFocus = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useDismissibleLayer({
    open,
    insideRefs: [triggerRef, panelRef],
    dismissOnFocusOutside: true,
    preventEscapeDefault: true,
    stopEscapePropagation: true,
    onDismiss: (reason) => {
      if (reason === "escape") closeAndReturnFocus();
      else setOpen(false);
    },
  });

  useLayoutEffect(() => {
    if (!open) return;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(enabledMenuItemSelector);
    (firstItem ?? panelRef.current?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
  }, [open]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      // Let the native Tab action continue from the trigger's position in the page.
      closeAndReturnFocus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(enabledMenuItemSelector) ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Home") {
      items[0].focus();
      return;
    }
    if (event.key === "End") {
      items[items.length - 1].focus();
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + delta + items.length) % items.length;
    items[nextIndex].focus();
  };

  const visibleSections = sections.filter((section) => section.items.length > 0);

  return (
    <span className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      <AnchoredPortalMenu
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        offset={4}
        minWidth={minWidth}
        className={cx(uiMenuClass, "ui-action-menu", menuClassName)}
      >
        <div ref={panelRef}>
          <div className="ui-action-menu-header">
            <ListActionButton onClick={closeAndReturnFocus} aria-label={`Close ${ariaLabel}`}>
              Close
            </ListActionButton>
          </div>
          <div ref={menuRef} id={menuId} role="menu" aria-label={ariaLabel} onKeyDown={handleMenuKeyDown}>
            {visibleSections.map((section, sectionIndex) => (
              <div
                key={section.id}
                className={cx(sectionIndex > 0 && "mt-1 border-t border-[color:var(--ui-border-soft)] pt-1")}
              >
                {section.label ? <p
                  role="presentation"
                  className={cx("px-2 py-1 ui-caption font-semibold uppercase tracking-wide", uiMutedTextClass)}
                >
                  {section.label}
                </p> : null}
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={cx(
                      "ui-list-menu-item",
                      item.disabled && "cursor-not-allowed opacity-60",
                      item.danger && "text-[var(--list-danger-text)]"
                    )}
                    aria-disabled={item.disabled || undefined}
                    title={item.disabled ? item.disabledReason ?? item.title : item.title}
                    onClick={() => {
                      if (item.disabled) return;
                      closeAndReturnFocus();
                      item.onSelect();
                    }}
                  >
                    <span className="flex min-w-0 flex-col break-words">
                      <span>{item.label}</span>
                      {item.disabled && item.disabledReason ? (
                        <span className={cx("mt-0.5 font-normal leading-4", uiMutedTextClass)}>{item.disabledReason}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </AnchoredPortalMenu>
    </span>
  );
}
