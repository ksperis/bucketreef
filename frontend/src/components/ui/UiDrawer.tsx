/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

import { getFocusableElements, trapFocusWithin } from "./focusTrap";
import { hasOpenModal } from "./modalStack";
import { cx, uiDividerClass } from "./styles";
import UiIconButton from "./UiIconButton";

type UiDrawerProps = {
  ariaLabelledBy: string;
  children: ReactNode;
  modal?: boolean;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  onEscape?: () => void;
  placement?: "left" | "right";
  workspace?: boolean;
  rootClassName?: string;
  showBackdrop?: boolean;
  backdropLabel?: string;
  closeOnBackdropClick?: boolean;
  surfaceClassName?: string;
};

export const uiDrawerBodyClass =
  "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4";

export default function UiDrawer({
  ariaLabelledBy,
  children,
  modal = true,
  onClose,
  returnFocus,
  onEscape,
  placement = "right",
  workspace = false,
  rootClassName = "inset-0",
  showBackdrop = false,
  backdropLabel = "Close drawer",
  closeOnBackdropClick = true,
  surfaceClassName,
}: UiDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocus);
  useEffect(() => {
    returnFocusRef.current = returnFocus;
  }, [returnFocus]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const target = returnFocusRef.current?.() ?? previousFocusRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (hasOpenModal() || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        (onEscape ?? onClose)();
        return;
      }
      if (modal) trapFocusWithin(drawer, event);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modal, onClose, onEscape]);

  useEffect(() => {
    if (!modal) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!drawer.contains(document.activeElement)) {
      const focusable = getFocusableElements(drawer);
      (focusable[0] ?? drawer).focus();
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modal]);

  return (
    <div
      role="presentation"
      data-modal={modal}
      className={cx(
        "fixed z-[46] !m-0",
        workspace && "ui-workspace-drawer",
        !showBackdrop && "pointer-events-none",
        rootClassName,
      )}
    >
      {showBackdrop ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={backdropLabel}
          className="absolute inset-0 bg-black/50"
          onClick={closeOnBackdropClick ? onClose : undefined}
        />
      ) : null}
      <section
        ref={drawerRef}
        role={modal ? "dialog" : "complementary"}
        aria-modal={modal ? true : undefined}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        className={cx(
          "pointer-events-auto absolute inset-y-0 flex min-w-0 flex-col overflow-hidden border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)]",
          placement === "left" ? "left-0 border-r" : "right-0 border-l",
          surfaceClassName,
        )}
      >
        {children}
      </section>
    </div>
  );
}

export function UiDrawerHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header
      {...props}
      className={cx("shrink-0 border-b px-4 py-3", uiDividerClass, className)}
    />
  );
}

export function UiDrawerCloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <UiIconButton
      variant="ghost"
      label={label}
      onClick={onClose}
      icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>}
    />
  );
}

export function UiDrawerBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx(uiDrawerBodyClass, className)} />;
}

export function UiDrawerFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cx(
        "shrink-0 border-t bg-[var(--ui-surface)] px-4 py-3",
        uiDividerClass,
        className,
      )}
    />
  );
}
