/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { useI18n, type I18nMessage } from "../i18n";

const m = (en: string, zh: string) => ({ en, zh });

const workspaceIncidentsMessages = {
  title: m("Ongoing / Recent Incidents", "进行中 / 近期事件"),
  description: m("Ongoing incidents and incidents ended in the last {window}.", "进行中的事件，以及最近 {window} 内已结束的事件。"),
  loading: m("Loading incidents…", "正在加载事件…"),
  empty: m("No ongoing or recent incidents.", "没有进行中或近期事件。"),
  ongoingSince: m("Ongoing since", "开始时间"),
  from: m("From", "从"),
  toDate: m(" to {date}", " 至 {date}"),
  inProgress: m("In progress", "进行中"),
  resolved: m("Resolved", "已恢复"),
  moreIncidents: m("+ {count} more incident(s)", "+ {count} 个其他事件"),
  day: m("{count} day", "{count} 天"),
  days: m("{count} days", "{count} 天"),
  hour: m("{count} hour", "{count} 小时"),
  hours: m("{count} hours", "{count} 小时"),
  minute: m("{count} minute", "{count} 分钟"),
  minutes: m("{count} minutes", "{count} 分钟"),
} satisfies Record<string, I18nMessage>;

type WorkspaceIncidentsMessageKey = keyof typeof workspaceIncidentsMessages;

export function useWorkspaceIncidentsI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: WorkspaceIncidentsMessageKey, values?: Record<string, string | number>) =>
      t(workspaceIncidentsMessages[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
    [t],
  );
  return { text };
}
