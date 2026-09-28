/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

export type ObjectPreviewNavigation = { previous?: () => void; next?: () => void; position?: string };

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
  navigation?: ObjectPreviewNavigation;
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
        navigation || primaryAction || secondaryActions.length > 0 ? (
          <>
            {navigation ? <div className="flex items-center gap-1" role="group" aria-label={t({ en: "Loaded files", fr: "Fichiers chargés", de: "Geladene Dateien", zh: "已加载的文件" })}>
              <UiButton size="sm" variant="secondary" disabled={!navigation.previous} onClick={navigation.previous}>{t({ en: "Previous", fr: "Précédent", de: "Zurück", zh: "上一个" })}</UiButton>
              {navigation.position ? <span className="ui-caption whitespace-nowrap">{navigation.position}</span> : null}
              <UiButton size="sm" variant="secondary" disabled={!navigation.next} onClick={navigation.next}>{t({ en: "Next", fr: "Suivant", de: "Weiter", zh: "下一个" })}</UiButton>
            </div> : null}
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
