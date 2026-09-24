/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import UiActionMenu from "../../components/ui/UiActionMenu";
import UiButton, { uiButtonClassName } from "../../components/ui/UiButton";
import DetailsDrawerShell from "./DetailsDrawerShell";

type ObjectDetailsDrawerAction = {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "danger";
  onSelect: () => void;
};

type ObjectDetailsDrawerProps = {
  activeTab?: string;
  children: ReactNode;
  copyPathLabel: string;
  moreLabel: string;
  name: string;
  notice?: ReactNode;
  onClose: () => void;
  onCopyPath: () => void;
  onTabChange?: (tabId: string) => void;
  path: string;
  primaryAction?: {
    label: string;
    loading?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  };
  secondaryActions?: readonly ObjectDetailsDrawerAction[];
  tabs?: readonly { id: string; label: string }[];
  tabsAriaLabel?: string;
};

export default function ObjectDetailsDrawer({
  activeTab,
  children,
  copyPathLabel,
  moreLabel,
  name,
  notice,
  onClose,
  onCopyPath,
  onTabChange,
  path,
  primaryAction,
  secondaryActions = [],
  tabs = [],
  tabsAriaLabel,
}: ObjectDetailsDrawerProps) {
  return (
    <DetailsDrawerShell
      title={name}
      subtitle={
        <div className="flex min-w-0 items-center gap-2 ui-caption text-[var(--ui-text-muted)]">
          <span className="min-w-0 flex-1 truncate" title={path}>
            {path}
          </span>
          <button
            type="button"
            className="shrink-0 font-semibold text-primary hover:underline"
            onClick={onCopyPath}
          >
            {copyPathLabel}
          </button>
        </div>
      }
      actions={
        primaryAction || secondaryActions.length > 0 ? (
          <>
            {primaryAction ? (
              <UiButton
                size="sm"
                variant="primary"
                loading={primaryAction.loading}
                disabled={primaryAction.disabled}
                onClick={primaryAction.onSelect}
              >
                {primaryAction.label}
              </UiButton>
            ) : null}
            {secondaryActions.length > 0 ? (
              <UiActionMenu
                key={path}
                ariaLabel={moreLabel}
                trigger={moreLabel}
                triggerClassName={uiButtonClassName({ variant: "secondary", size: "sm" })}
                placement="bottom-end"
                minWidth={176}
                sections={[
                  {
                    id: "actions",
                    items: secondaryActions.map((action) => ({
                      id: action.id,
                      label: action.label,
                      disabled: action.disabled,
                      disabledReason: action.disabled ? action.title : undefined,
                      title: action.title,
                      danger: action.tone === "danger",
                      onSelect: action.onSelect,
                    })),
                  },
                ]}
              />
            ) : null}
          </>
        ) : undefined
      }
      activeTab={activeTab}
      tabs={tabs}
      tabsAriaLabel={tabsAriaLabel}
      notice={notice}
      onClose={onClose}
      onTabChange={onTabChange}
    >
      {children}
    </DetailsDrawerShell>
  );
}
