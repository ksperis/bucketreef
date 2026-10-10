/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useMemo } from "react";
import type { ExecutionContext } from "../api/executionContexts";
import { formatAccountLabel } from "../features/shared/storageEndpointLabel";
import { useSelectorTagsPreference } from "../utils/selectorTagsPreference";
import {
  buildUiTagItems,
  extractUiTagLabels,
  filterSelectorVisibleUiTags,
} from "../utils/uiTags";
import TopbarDropdownSelect, {
  type TopbarDropdownOption,
} from "./TopbarDropdownSelect";
import UiTagBadgeList from "./UiTagBadgeList";
import { TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS } from "./topbarControlWidths";
import { translate } from "../i18n";
import { shellMessages, useShellI18n, type ShellText } from "./shellMessages";

export type ContextAccessMode =
  | "admin"
  | "session"
  | "s3_user"
  | "connection"
  | null;

const defaultShellText: ShellText = (key, values) =>
  translate(shellMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match));

export function getContextAccessModeVisual(mode: ContextAccessMode, text: ShellText = defaultShellText): {
  label: string;
  shortLabel: string;
  classes: string;
} {
  if (mode === "admin") {
    return {
      label: text("adminMode"),
      shortLabel: text("adminShort"),
      classes:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
    };
  }
  if (mode === "connection") {
    return {
      label: text("connectionMode"),
      shortLabel: text("connectionShort"),
      classes:
        "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-100",
    };
  }
  if (mode === "s3_user") {
    return {
      label: text("s3UserMode"),
      shortLabel: text("s3UserShort"),
      classes:
        "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-100",
    };
  }
  return {
    label: text("session"),
    shortLabel: text("session"),
    classes:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  };
}

function contextKindRank(kind: ExecutionContext["kind"]): number {
  if (kind === "account") return 0;
  if (kind === "s3_user") return 1;
  return 2;
}

type TopbarContextAccountSelectorProps = {
  contexts: ExecutionContext[];
  selectedContextId: string | null;
  onContextChange: (selectedValue: string) => void;
  selectedLabel: string;
  identityLabel: string | null;
  widthClassName?: string;
  searchThreshold?: number;
  openInPortal?: boolean;
  icon?: ReactNode;
  triggerMode?: "icon" | "icon_label";
  showTriggerTags?: boolean;
};

export default function TopbarContextAccountSelector({
  contexts,
  selectedContextId,
  onContextChange,
  selectedLabel,
  identityLabel,
  widthClassName = TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
  searchThreshold = 6,
  openInPortal = true,
  icon,
  triggerMode = "icon_label",
  showTriggerTags = true,
}: TopbarContextAccountSelectorProps) {
  const { text } = useShellI18n();
  const showSelectorTags = useSelectorTagsPreference();
  const options = useMemo<TopbarDropdownOption[]>(
    () =>
      contexts
        .map((context) => {
          const label = formatAccountLabel(context);
          const description =
            context.kind === "connection"
              ? context.connection_scope === "shared"
                ? text("sharedConnection")
                : text("privateConnection")
              : context.kind === "s3_user"
                ? text("s3UserIdentity")
                : text("rgwAccount");
          const selectorEntityTags = filterSelectorVisibleUiTags(context.tags);
          const selectorEndpointTags = filterSelectorVisibleUiTags(
            context.endpoint_tags,
          );
          const tagItems = buildUiTagItems(
            selectorEntityTags,
            selectorEndpointTags,
          );
          const displayName = context.display_name.trim();
          const optionDescription = context.endpoint_url
            ? `${description} · ${context.endpoint_url}`
            : description;
          const searchText = [
            context.display_name,
            context.endpoint_name,
            context.endpoint_url,
            ...extractUiTagLabels(selectorEntityTags),
            ...extractUiTagLabels(selectorEndpointTags),
          ]
            .filter(Boolean)
            .join(" ");
          return {
            value: context.id,
            kind: context.kind,
            typeRank: contextKindRank(context.kind),
            displayName,
            label,
            description: optionDescription,
            searchText,
            inlineAddon:
              showSelectorTags && tagItems.length > 0 ? (
                <UiTagBadgeList
                  items={tagItems}
                  layout="inline-compact"
                  className="max-w-full"
                  maxVisible={4}
                />
              ) : undefined,
            triggerAddon:
              showTriggerTags &&
              showSelectorTags &&
              triggerMode !== "icon" &&
              tagItems.length > 0 ? (
                <UiTagBadgeList
                  items={tagItems}
                  layout="inline-compact"
                  maxVisible={3}
                  className="max-w-full"
                />
              ) : undefined,
          };
        })
        .sort((a, b) => {
          if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
          const byDisplayName = a.displayName.localeCompare(
            b.displayName,
            undefined,
            { sensitivity: "base" },
          );
          if (byDisplayName !== 0) return byDisplayName;
          const byLabel = a.label.localeCompare(b.label, undefined, {
            sensitivity: "base",
          });
          if (byLabel !== 0) return byLabel;
          return a.value.localeCompare(b.value, undefined, {
            sensitivity: "base",
          });
        }),
    [
      contexts,
      showSelectorTags,
      showTriggerTags,
      text,
      triggerMode,
    ],
  );

  return (
    <TopbarDropdownSelect
      value={selectedContextId ?? ""}
      options={options}
      onChange={onContextChange}
      ariaLabel={text("selectContextAccount")}
      triggerLabel={text("account")}
      placeholder={selectedLabel}
      triggerValue={selectedLabel}
      title={identityLabel ?? undefined}
      widthClassName={widthClassName}
      menuHeader={
        <div className="shell-menu-muted rounded-md border px-2.5 py-2">
          <p className="shell-muted-text ui-caption uppercase">
            {text("currentIamIdentity")}
          </p>
          <p className="truncate ui-caption font-semibold text-[var(--shell-text)]">
            {identityLabel ?? text("unavailableForContext")}
          </p>
        </div>
      }
      search={{
        threshold: searchThreshold,
        ariaLabel: text("searchAccounts"),
        placeholder: text("searchAccountPlaceholder"),
        emptyMessage: text("noAccountMatches"),
      }}
      icon={icon}
      openInPortal={openInPortal}
      triggerMode={triggerMode}
    />
  );
}
