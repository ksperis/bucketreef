/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useId } from "react";

import PageTabs, { PageTabPanel, type PageTab } from "../../components/PageTabs";
import UiDrawer, { UiDrawerHeader, uiDrawerBodyClass } from "../../components/ui/UiDrawer";
import UiIconButton from "../../components/ui/UiIconButton";
import { cx, uiTitleTextClass } from "../../components/ui/styles";
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
  const idPrefix = useId();
  const modal = useMediaQuery(DETAILS_DRAWER_MODAL_MEDIA_QUERY);

  return (
    <UiDrawer
      ariaLabelledBy={`${idPrefix}-title`}
      modal={modal}
      onClose={onClose}
      onEscape={onEscape}
      rootClassName="inset-0 lg:left-auto lg:top-14"
      surfaceClassName="w-full lg:w-[min(48rem,calc(100vw-20rem))]"
    >
        <UiDrawerHeader>
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
              <UiIconButton
                variant="ghost"
                onClick={onClose}
                label="Close details"
                icon={<XIcon className="h-4 w-4" />}
              />
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
        </UiDrawerHeader>
        {activeTab ? (
          <PageTabPanel
            idPrefix={idPrefix}
            tabId={activeTab}
            className={uiDrawerBodyClass}
          >
            {children}
          </PageTabPanel>
        ) : (
          <div className={uiDrawerBodyClass}>
            {children}
          </div>
        )}
    </UiDrawer>
  );
}
