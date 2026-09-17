/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListActionLink, ListActionButton } from "../../components/list/ListControls";
import { useMemo, useState } from "react";

import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import PageEmptyState from "../../components/PageEmptyState";

import ListPageSection from "../../components/list/ListPageSection";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import type {
  PortalWorkspaceActivityItem,
  PortalWorkspaceModel,
} from "./portalWorkspaceModel";

function activitySpacePath(item: PortalWorkspaceActivityItem): string | null {
  return item.spaceId ? `/portal/storage-spaces/${encodeURIComponent(item.spaceId)}` : null;
}

type PortalActivityPanelProps = {
  workspace: Pick<PortalWorkspaceModel, "activity" | "spaces">;
};

export default function PortalActivityPanel({ workspace }: PortalActivityPanelProps) {
  const { t } = useI18n();
  const [actionFilter, setActionFilter] = useState("all");
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const actionOptions = useMemo(
    () => Array.from(new Set(workspace.activity.map((item) => item.action))).sort(),
    [workspace.activity]
  );
  const rows = useMemo(
    () =>
      workspace.activity.filter((item) => {
        const actionMatch = actionFilter === "all" || item.action === actionFilter;
        const spaceMatch = spaceFilter === "all" || item.spaceName === spaceFilter;
        return actionMatch && spaceMatch;
      }),
    [actionFilter, spaceFilter, workspace.activity]
  );
  const tableStatus = rows.length === 0 ? "empty" : "ready";
  const emptyActivityMessage =
    workspace.activity.length === 0
      ? t({
          en: "No recent governance changes. Create a space, update settings, or manage access to build a history here.",
          fr: "Aucun changement de gouvernance récent. Créez un espace, modifiez des paramètres ou gérez les accès pour construire l'historique.",
          de: "Noch keine Governance-Änderungen. Erstellen Sie einen Bereich, ändern Sie Einstellungen oder verwalten Sie Zugriffe, um hier einen Verlauf aufzubauen.",
          zh: "近期没有管理变更。创建空间、更新设置或管理访问权限后，这里将显示历史记录。",
        })
      : t({
          en: "No matching activity. Adjust the filters to see more changes.",
          fr: "Aucune activité ne correspond. Ajustez les filtres pour voir plus de changements.",
          de: "Keine passende Aktivität. Passen Sie die Filter an, um mehr Änderungen zu sehen.",
          zh: "没有匹配的活动。请调整筛选条件以查看更多变更。",
        });
  const activityColumns = useMemo<DataTableColumn<PortalWorkspaceActivityItem>[]>(
    () => [
      {
        id: "event",
        label: t({ en: "Change", fr: "Changement", de: "Änderung", zh: "变更" }),
        primary: true,
        cellClassName: "break-words",
        render: (item) => (
          <div className="min-w-0">
            <div className={cx("font-semibold", uiTitleTextClass)}>
              {item.actor}
            </div>
            <div className={cx("mt-0.5 text-xs", uiMutedTextClass)}>
              {item.action} · {item.target}
            </div>
          </div>
        ),
      },
      {
        id: "time",
        label: t({ en: "When", fr: "Quand", de: "Wann", zh: "时间" }),
        render: (item) => item.timeLabel,
      },
      {
        id: "space",
        label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }),
        cellClassName: "break-words",
        render: (item) => item.spaceName,
      },
      {
        id: "details",
        label: t({ en: "Actions", fr: "Actions", de: "Aktionen", zh: "操作" }),
        align: "right",
        mobileRole: "actions",
        render: (item) => {
          const expanded = expandedActivityId === item.id;
          const spacePath = activitySpacePath(item);
          return (
            <ListActions className="max-md:justify-start">
              {spacePath ? (
                <ListActionLink
                  to={spacePath}

                >
                  {t({ en: "Open space", fr: "Ouvrir l'espace", de: "Bereich öffnen", zh: "打开空间" })}
                </ListActionLink>
              ) : null}
              <ListActionButton
                type="button"
                onClick={() => setExpandedActivityId(expanded ? null : item.id)}

                {...dataTableDefaultActionProps}
              >
                {expanded ? t({ en: "Hide details", fr: "Masquer les détails", de: "Details ausblenden", zh: "隐藏详情" }) : t({ en: "Show details", fr: "Afficher les détails", de: "Details anzeigen", zh: "显示详情" })}
              </ListActionButton>
            </ListActions>
          );
        },
      },
    ],
    [expandedActivityId, t]
  );
  const activityFilters = (
    <>
      <UiSelect
        label={t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" })}
        size="compact"
        value={actionFilter}
        onChange={(event) => setActionFilter(event.target.value)}
      >
        <option value="all">{t({ en: "All actions", fr: "Toutes les actions", de: "Alle Aktionen", zh: "所有操作" })}</option>
        {actionOptions.map((action) => (
          <option key={action} value={action}>{action}</option>
        ))}
      </UiSelect>
      <UiSelect
        label={t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" })}
        size="compact"
        value={spaceFilter}
        onChange={(event) => setSpaceFilter(event.target.value)}
      >
        <option value="all">{t({ en: "All spaces", fr: "Tous les espaces", de: "Alle Bereiche", zh: "所有空间" })}</option>
        {workspace.spaces.map((space) => (
          <option key={space.id} value={space.name}>{space.name}</option>
        ))}
      </UiSelect>
    </>
  );
  const activityTable = (columns: DataTableColumn<PortalWorkspaceActivityItem>[]) => (
    <>
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(item) => item.id}
        status={tableStatus}
        loadingMessage={t({ en: "Loading activity...", fr: "Chargement de l'activité...", de: "Aktivität wird geladen...", zh: "正在加载活动…" })}
        errorMessage={t({ en: "Unable to load activity.", fr: "Impossible de charger l'activité.", de: "Aktivität kann nicht geladen werden.", zh: "无法加载活动。" })}
        emptyMessage={emptyActivityMessage}
        expandedRow={(item) =>
          expandedActivityId === item.id ? (
            <dl className={cx(uiCardMutedClass, "grid gap-2 px-3 py-2 text-xs sm:grid-cols-[140px_1fr]")}>
              <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Resource", fr: "Ressource", de: "Ressource", zh: "资源" })}</dt>
              <dd className={cx(uiTitleTextClass, "break-all")}>{item.target}</dd>
              <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" })}</dt>
              <dd className={uiTitleTextClass}>{item.action}</dd>
              <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "IP address", fr: "Adresse IP", de: "IP-Adresse", zh: "IP 地址" })}</dt>
              <dd className={uiTitleTextClass}>{item.ipAddress || "-"}</dd>
            </dl>
          ) : null
        }
        responsiveCards
      />
    </>
  );

  return (
    <div className="space-y-4">
      {workspace.activity.length === 0 ? (
        <PageEmptyState
          eyebrow={t({ en: "No history yet", fr: "Aucun historique", de: "Noch kein Verlauf", zh: "暂无历史记录" })}
          title={t({ en: "Activity starts with your spaces", fr: "L'activité commence dans vos espaces", de: "Aktivität beginnt in Ihren Bereichen", zh: "空间操作会记录在这里" })}
          description={t({
            en: "Create spaces, manage collaborators and links, or update settings. The latest governance changes will appear here.",
            fr: "Créez des espaces, gérez les collaborateurs et les liens, ou modifiez les paramètres. Les derniers changements de gouvernance apparaîtront ici.",
            de: "Erstellen Sie Bereiche, verwalten Sie Mitwirkende und Links oder ändern Sie Einstellungen. Die letzten Governance-Änderungen erscheinen hier.",
            zh: "创建空间、管理协作者和链接或更新设置。最新的管理变更将显示在这里。",
          })}
          primaryAction={{ label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen", zh: "打开空间列表" }), to: "/portal/storage-spaces" }}
        />
      ) : (
        <ListPageSection variant="page"
          title={t({ en: "Recent activity", fr: "Activité récente", de: "Letzte Aktivität", zh: "近期活动" })}
          countLabel={t({
            en: `${rows.length} of ${workspace.activity.length} changes`,
            fr: `${rows.length} sur ${workspace.activity.length} changements`,
            de: `${rows.length} von ${workspace.activity.length} Änderungen`,
            zh: `${workspace.activity.length} 项变更中的 ${rows.length} 项`,
          })}
          filters={activityFilters}
        >
          {activityTable(activityColumns)}
        </ListPageSection>
      )}
    </div>
  );
}
