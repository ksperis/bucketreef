/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

import PageTabs, { PageTabPanel, type PageTab } from "../../components/PageTabs";
import UiButton from "../../components/ui/UiButton";
import { hasOpenModal } from "../../components/Modal";
import { getFocusableElements, trapFocusWithin } from "../../components/ui/focusTrap";
import { cx, uiDividerClass, uiTitleTextClass } from "../../components/ui/styles";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { XIcon } from "../browser/browserIcons";

const DETAILS_DRAWER_MODAL_MEDIA_QUERY = "(max-width: 1023px)";

type DetailsDrawerShellProps = {
  activeTab?: string;
  actions?: ReactNode;
  children: ReactNode;
  notice?: ReactNode;
  onClose: () => void;
  onEscape?: () => void;
  onTabChange?: (tabId: string) => void;
  subtitle?: ReactNode;
  tabs?: readonly PageTab[];
  tabsAriaLabel?: string;
  title: string;
};

export default function DetailsDrawerShell({
  activeTab,
  actions,
  children,
  notice,
  onClose,
  onEscape,
  onTabChange,
  subtitle,
  tabs = [],
  tabsAriaLabel = "Details views",
  title,
}: DetailsDrawerShellProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const idPrefix = useId();
  const modal = useMediaQuery(DETAILS_DRAWER_MODAL_MEDIA_QUERY);

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
    <div className="pointer-events-none fixed inset-0 z-[46] lg:left-auto lg:top-14">
      <section
        ref={drawerRef}
        role={modal ? "dialog" : "complementary"}
        aria-modal={modal ? true : undefined}
        aria-labelledby={`${idPrefix}-title`}
        tabIndex={-1}
        className="pointer-events-auto absolute inset-y-0 right-0 flex w-full min-w-0 flex-col overflow-hidden border-l border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)] lg:w-[min(48rem,calc(100vw-20rem))]"
      >
        <header className={cx("shrink-0 border-b px-4 py-3", uiDividerClass)}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id={`${idPrefix}-title`}
                className={cx("truncate ui-subtitle", uiTitleTextClass)}
                title={title}
              >
                {title}
              </h2>
              {subtitle ? <div className="mt-1 min-w-0">{subtitle}</div> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {actions}
              <UiButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close details"
                title="Close details"
              >
                <XIcon className="h-4 w-4" />
              </UiButton>
            </div>
          </div>
          {tabs.length > 0 && activeTab && onTabChange ? (
            <div className="mt-3 border-t border-[color:var(--ui-border-soft)] pt-3">
              <PageTabs
                tabs={tabs}
                activeTab={activeTab}
                onChange={onTabChange}
                variant="bar"
                ariaLabel={tabsAriaLabel}
                idPrefix={idPrefix}
              />
            </div>
          ) : null}
          {notice ? <div className="mt-3">{notice}</div> : null}
        </header>
        {activeTab ? (
          <PageTabPanel
            idPrefix={idPrefix}
            tabId={activeTab}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
          >
            {children}
          </PageTabPanel>
        ) : (
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
            {children}
          </div>
        )}
      </section>
    </div>
  );
}
