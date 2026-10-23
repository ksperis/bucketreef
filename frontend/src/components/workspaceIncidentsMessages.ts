/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback } from "react";
import { interpolateText, useI18n, type I18nMessage } from "../i18n";

const m = (en: string, fr: string, de: string, zh: string): I18nMessage => ({ en, fr, de, zh });

const workspaceIncidentsMessages = {
  title: m("Ongoing / Recent Incidents", "Incidents en cours / récents", "Laufende / kürzliche Vorfälle", "进行中 / 近期事件"),
  description: m(
    "Ongoing incidents and incidents ended in the last {window}.",
    "Incidents en cours et incidents terminés au cours des {window}.",
    "Laufende Vorfälle und Vorfälle, die in den letzten {window} beendet wurden.",
    "进行中的事件，以及最近 {window} 内已结束的事件。",
  ),
  loading: m("Loading incidents…", "Chargement des incidents…", "Vorfälle werden geladen…", "正在加载事件…"),
  empty: m("No ongoing or recent incidents.", "Aucun incident en cours ou récent.", "Keine laufenden oder kürzlichen Vorfälle.", "没有进行中或近期事件。"),
  ongoingSince: m("Ongoing since", "En cours depuis", "Läuft seit", "开始时间"),
  from: m("From", "Du", "Von", "从"),
  toDate: m(" to {date}", " au {date}", " bis {date}", " 至 {date}"),
  inProgress: m("In progress", "En cours", "Laufend", "进行中"),
  resolved: m("Resolved", "Résolu", "Behoben", "已恢复"),
  moreIncidents: m("+ {count} more incident(s)", "+ {count} incident(s) supplémentaire(s)", "+ {count} weitere Vorfälle", "+ {count} 个其他事件"),
  day: m("{count} day", "{count} jour", "{count} Tag", "{count} 天"),
  days: m("{count} days", "{count} jours", "{count} Tage", "{count} 天"),
  hour: m("{count} hour", "{count} heure", "{count} Stunde", "{count} 小时"),
  hours: m("{count} hours", "{count} heures", "{count} Stunden", "{count} 小时"),
  minute: m("{count} minute", "{count} minute", "{count} Minute", "{count} 分钟"),
  minutes: m("{count} minutes", "{count} minutes", "{count} Minuten", "{count} 分钟"),
} satisfies Record<string, I18nMessage>;

type WorkspaceIncidentsMessageKey = keyof typeof workspaceIncidentsMessages;

export function useWorkspaceIncidentsI18n() {
  const { t } = useI18n();
  const text = useCallback(
    (key: WorkspaceIncidentsMessageKey, values?: Record<string, string | number>) =>
      interpolateText(t(workspaceIncidentsMessages[key]), values),
    [t],
  );
  return { text };
}
