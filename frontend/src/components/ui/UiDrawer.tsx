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

type UiDrawerProps = {
  ariaLabelledBy: string;
  children: ReactNode;
  modal?: boolean;
  onClose: () => void;
  onEscape?: () => void;
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
  onEscape,
  rootClassName = "inset-0",
  showBackdrop = false,
  backdropLabel = "Close drawer",
  closeOnBackdropClick = true,
  surfaceClassName,
}: UiDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
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
    const focusable = getFocusableElements(drawer);
    (focusable[0] ?? drawer).focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modal]);

  return (
    <div
      role="presentation"
      className={cx(
        "fixed z-[46]",
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
          "pointer-events-auto absolute inset-y-0 right-0 flex min-w-0 flex-col overflow-hidden border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)]",
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
