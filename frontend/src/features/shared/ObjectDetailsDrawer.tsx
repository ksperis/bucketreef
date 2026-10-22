/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode } from "react";
import { useI18n } from "../../i18n";

import UiActionMenu from "../../components/ui/UiActionMenu";
import UiButton, { uiButtonClassName } from "../../components/ui/UiButton";
import DetailsDrawerShell from "./DetailsDrawerShell";
import DetailsDrawerNavigation, {
  type DetailsDrawerNavigationState,
} from "./DetailsDrawerNavigation";

export type ObjectPreviewNavigation = DetailsDrawerNavigationState;

type ObjectDetailsDrawerAction = {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "danger";
  onSelect: () => void;
};

type ObjectDetailsDrawerProps = {
  navigation?: ObjectPreviewNavigation;
  activeTab?: string;
  children: ReactNode;
  copyPathLabel?: string;
  moreLabel: string;
  name: string;
  notice?: ReactNode;
  onClose: () => void;
  onCopyPath?: () => void;
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
  navigation,
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
  const { t } = useI18n();
  const navigationActions = navigation ? (
    <DetailsDrawerNavigation
      navigation={navigation}
      labels={{
        group: t({ en: "Loaded files", fr: "Fichiers chargés", de: "Geladene Dateien", zh: "已加载的文件" }),
        previous: t({ en: "Previous object", fr: "Objet précédent", de: "Vorheriges Objekt", zh: "上一个对象" }),
        next: t({ en: "Next object", fr: "Objet suivant", de: "Nächstes Objekt", zh: "下一个对象" }),
      }}
    />
  ) : undefined;

  return (
    <DetailsDrawerShell
      title={name}
      returnFocus={navigation?.returnFocus}
      subtitle={
        <div className="flex min-w-0 items-center gap-2 ui-caption text-[var(--ui-text-muted)]">
          <span className="min-w-0 flex-1 truncate" title={path}>
            {path}
          </span>
          {copyPathLabel && onCopyPath ? (
            <button
              type="button"
              className="shrink-0 font-semibold text-primary hover:underline"
              onClick={onCopyPath}
            >
              {copyPathLabel}
            </button>
          ) : null}
        </div>
      }
      actions={
        navigationActions || primaryAction || secondaryActions.length > 0 ? (
          <>
            {navigationActions}
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
