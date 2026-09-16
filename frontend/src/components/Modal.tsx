/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, RefObject, useEffect, useId, useRef, useState } from "react";
import UiButton from "./ui/UiButton";
import { getFocusableElements, trapFocusWithin } from "./ui/focusTrap";
import { cx, uiCardClass, uiDividerClass, uiTitleTextClass } from "./ui/styles";
import "./modal.css";

const modalStack: string[] = [];
const modalStackListeners = new Set<() => void>();

/** Contextual drawers yield keyboard ownership while a modal covers them. */
export function hasOpenModal() {
  return modalStack.length > 0;
}

function notifyModalStackListeners() {
  modalStackListeners.forEach((listener) => listener());
}

function isTopModal(modalId: string) {
  return modalStack[modalStack.length - 1] === modalId;
}

type ModalProps = {
  title: string;
  className?: string;
  titleAs?: "h2" | "h3";
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  maxBodyHeightClass?: string;
  zIndexClass?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  closeOnEscape?: boolean;
  closeDisabled?: boolean;
  closeOnBackdropClick?: boolean;
  closeLabel?: string;
  closeAriaLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusOnClose?: boolean;
  trapFocus?: boolean;
};

export default function Modal({
  title,
  className,
  titleAs: Title = "h3",
  onClose,
  children,
  maxWidthClass = "max-w-2xl",
  maxBodyHeightClass = "max-h-[70vh]",
  zIndexClass = "z-50",
  ariaLabelledby,
  ariaDescribedby,
  closeOnEscape = true,
  closeDisabled = false,
  closeOnBackdropClick = true,
  closeLabel = "Close",
  closeAriaLabel = "Close modal",
  initialFocusRef,
  returnFocusOnClose = true,
  trapFocus = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const modalId = useId();
  const fallbackTitleId = `${modalId}-title`;
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [, setModalStackVersion] = useState(0);

  useEffect(() => {
    const rerenderOnModalStackChange = () => setModalStackVersion((version) => version + 1);
    modalStackListeners.add(rerenderOnModalStackChange);
    modalStack.push(modalId);
    notifyModalStackListeners();
    return () => {
      modalStackListeners.delete(rerenderOnModalStackChange);
      const index = modalStack.indexOf(modalId);
      if (index >= 0) {
        modalStack.splice(index, 1);
        notifyModalStackListeners();
      }
    };
  }, [modalId]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnFocusOnClose) {
        previousFocusRef.current?.focus();
      }
    };
  }, [returnFocusOnClose]);

  useEffect(() => {
    const container = dialogRef.current;
    if (!container) return;
    const preferred = initialFocusRef?.current;
    if (preferred && typeof preferred.focus === "function") {
      preferred.focus();
      return;
    }
    const focusable = getFocusableElements(container);
    if (focusable.length > 0) {
      focusable[0].focus();
      return;
    }
    container.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const container = dialogRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(modalId) || event.defaultPrevented) return;
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        if (!closeDisabled) onClose();
        return;
      }
      if (trapFocus) {
        trapFocusWithin(container, event);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDisabled, closeOnEscape, modalId, onClose, trapFocus]);

  return (
    <div
      className={cx(`modal-surface fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/50 px-4 py-6`, className)}
      role="presentation"
      onMouseDown={(event) => {
        if (!isTopModal(modalId)) return;
        if (!closeOnBackdropClick || closeDisabled) return;
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby ?? fallbackTitleId}
        aria-describedby={ariaDescribedby}
        tabIndex={-1}
        className={cx(
          "modal-dialog w-full whitespace-normal text-left shadow-[var(--shell-menu-shadow)]",
          uiCardClass,
          maxWidthClass,
        )}
      >
        <div className={cx("modal-header flex items-center justify-between border-b px-6 py-4", uiDividerClass)}>
          <Title id={fallbackTitleId} className={cx("modal-title ui-subtitle", uiTitleTextClass)}>
            {title}
          </Title>
          <UiButton variant="ghost" onClick={onClose} disabled={closeDisabled} className="modal-close py-1" aria-label={closeAriaLabel}>
            {closeLabel}
          </UiButton>
        </div>
        <div className={`modal-body ${maxBodyHeightClass} overflow-y-auto px-6 py-4`}>{children}</div>
      </div>
    </div>
  );
}
