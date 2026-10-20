/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import type { PortalStorageSpaceRole } from "../../api/portal";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { ListActions, ListActionLink } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import TableSortControls from "../../components/list/TableSortControls";
import StorageSpaceIcon from "../../components/StorageSpaceIcon";
import { UserAvatarStack } from "../../components/UserAvatar";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import {
  portalRoleLabel,
  portalShareScopeLabel,
  portalStatusLabel,
} from "./portalI18n";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import {
  portalStorageSpaceStatusTone,
  portalVisibilityTone,
} from "./portalUi";
import { storageSpacePath, type PortalWorkspaceSpace } from "./portalWorkspaceModel";

type SpacesTab = "active" | "archived";

type PortalStorageSpacesListProps = {
  spaces: PortalWorkspaceSpace[];
  canCreate: boolean;
};

function visibleStatus(space: { status: string }) {
  if (space.status === "Active") return null;
  return space.status;
}

export default function PortalStorageSpacesList({
  spaces,
  canCreate,
}: PortalStorageSpacesListProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PortalStorageSpaceRole | "all">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [activeTab, setActiveTab] = useState<SpacesTab>("active");
  const [mobileListControlsOpen, setMobileListControlsOpen] = useState(false);

  const activeSpaces = useMemo(
    () => spaces.filter((space) => space.status !== "Archived"),
    [spaces],
  );
  const archivedSpaces = useMemo(
    () => spaces.filter((space) => space.status === "Archived"),
    [spaces],
  );
  const visibleSpaces = activeTab === "archived" ? archivedSpaces : activeSpaces;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = useMemo(() => {
    const filtered = visibleSpaces.filter((space) => {
      if (roleFilter !== "all" && space.role !== roleFilter) return false;
      if (statusFilter !== "all" && space.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        space.name,
        space.description,
        space.ownerLabel,
        space.visibility,
        portalShareScopeLabel(space.visibility, space.shareScope, t),
        space.projectKey,
        space.datasetLabel,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
    return [...filtered].sort((a, b) => {
      if (sort === "created_at")
        return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      if (sort === "-created_at")
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      if (sort === "used_bytes")
        return (a.usedBytes ?? -1) - (b.usedBytes ?? -1);
      if (sort === "-used_bytes")
        return (b.usedBytes ?? -1) - (a.usedBytes ?? -1);
      if (sort === "object_count")
        return (a.objectCount ?? -1) - (b.objectCount ?? -1);
      if (sort === "-object_count")
        return (b.objectCount ?? -1) - (a.objectCount ?? -1);
      return sort === "-name"
        ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name);
    });
  }, [normalizedQuery, roleFilter, sort, statusFilter, t, visibleSpaces]);

  const tableSort = {
    field: sort.replace(/^-/, ""),
    direction: sort.startsWith("-") ? ("desc" as const) : ("asc" as const),
    onSort: (field: string) =>
      setSort((current) => (current === field ? `-${field}` : field)),
  };
  const tableStatus = filteredSpaces.length === 0 ? "empty" : "ready";
  const storageSpaceColumns = useMemo<DataTableColumn<PortalWorkspaceSpace>[]>(
    () => [
      {
        id: "name",
        field: "name",
        label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }),
        mobileLabel: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }),
        primary: true,
        render: (space) => (
          <div className="flex min-w-0 items-start gap-2">
            <StorageSpaceIcon
              icon={space.icon}
              name={space.name}
              size="sm"
              className="mt-0.5"
              decorative
            />
            <div className="min-w-0">
              <span className="block truncate">{space.name}</span>
              <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>
                {space.description}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: "access",
        label: t({
          en: "Collaborators",
          fr: "Collaborateurs",
          de: "Mitwirkende",
          zh: "协作者",
        }),
        render: (space) => {
          const status = visibleStatus(space);
          const collaborators = space.collaborators ?? [];
          const isWholeTeam =
            space.visibility === "shared" && space.shareScope === "account";
          return (
            <div className="flex min-w-[132px] flex-col items-start gap-2">
              {space.visibility === "private" || isWholeTeam ? (
                <UiBadge tone={portalVisibilityTone(space.visibility)}>
                  {portalShareScopeLabel(space.visibility, space.shareScope, t)}
                </UiBadge>
              ) : collaborators.length > 0 ? (
                <UserAvatarStack
                  people={collaborators}
                  totalCount={space.collaboratorCount ?? collaborators.length}
                  maxVisible={5}
                  size="sm"
                />
              ) : (
                <span className={cx("text-xs", uiMutedTextClass)}>
                  {t({
                    en: "No collaborators",
                    fr: "Aucun collaborateur",
                    de: "Keine Mitwirkenden",
                    zh: "没有协作者",
                  })}
                </span>
              )}
              {status ? (
                <UiBadge tone={portalStorageSpaceStatusTone(space)}>
                  {portalStatusLabel(
                    status as "Active" | "Attention" | "Archived",
                    t,
                  )}
                </UiBadge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "files",
        field: "object_count",
        label: t({ en: "Files", fr: "Fichiers", de: "Dateien", zh: "文件" }),
        render: (space) => formatCompactNumber(space.objectCount),
      },
      {
        id: "size",
        field: "used_bytes",
        label: t({ en: "Size", fr: "Taille", de: "Größe", zh: "大小" }),
        render: (space) => formatBytes(space.usedBytes),
      },
      {
        id: "created",
        field: "created_at",
        label: t({
          en: "Created",
          fr: "Créé",
          de: "Erstellt",
          zh: "创建时间",
        }),
        render: (space) => space.createdLabel,
      },
      {
        id: "region",
        label: t({ en: "Region", fr: "Région", de: "Region", zh: "区域" }),
        render: (space) => space.region,
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" }),
        align: "right",
        mobileRole: "actions",
        render: (space) => (
          <ListActions>
            <ListActionLink
              to={storageSpacePath(space)}
              {...dataTableDefaultActionProps}
            >
              {t({ en: "Open", fr: "Ouvrir", de: "Öffnen", zh: "打开" })}
            </ListActionLink>
          </ListActions>
        ),
      },
    ],
    [t],
  );

  const statusOptions = [
    { value: "Active", label: portalStatusLabel("Active", t) },
    { value: "Attention", label: portalStatusLabel("Attention", t) },
  ];

  useEffect(() => {
    setStatusFilter("all");
  }, [activeTab]);

  return (
    <>
      <PortalPageTabs
        tabs={[
          {
            id: "active",
            label: t({
              en: `Active spaces (${activeSpaces.length})`,
              fr: `Espaces actifs (${activeSpaces.length})`,
              de: `Aktive Bereiche (${activeSpaces.length})`,
              zh: `活跃空间（${activeSpaces.length}）`,
            }),
          },
          {
            id: "archived",
            label: t({
              en: `Archived (${archivedSpaces.length})`,
              fr: `Archivés (${archivedSpaces.length})`,
              de: `Archiviert (${archivedSpaces.length})`,
              zh: `已归档（${archivedSpaces.length}）`,
            }),
          },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as SpacesTab)}
        ariaLabel={t({
          en: "Storage space views",
          fr: "Vues des espaces de stockage",
          de: "Speicherbereichsansichten",
          zh: "存储空间视图",
        })}
        idPrefix="portal-storage-spaces"
      />

      <PortalTabPanel idPrefix="portal-storage-spaces" tabId={activeTab}>
        <ListPageSection
          variant="page"
          title={t({
            en: "Storage spaces",
            fr: "Espaces de stockage",
            de: "Speicherbereiche",
            zh: "存储空间",
          })}
          countLabel={t({
            en: `${filteredSpaces.length} of ${visibleSpaces.length} spaces`,
            fr: `${filteredSpaces.length} sur ${visibleSpaces.length} espaces`,
            de: `${filteredSpaces.length} von ${visibleSpaces.length} Bereichen`,
            zh: `共 ${visibleSpaces.length} 个空间，显示 ${filteredSpaces.length} 个`,
          })}
          search={
            <UiInput
              label={t({ en: "Search", fr: "Recherche", de: "Suche", zh: "搜索" })}
              type="search"
              size="compact"
              className="ui-list-control"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t({
                en: "Search spaces...",
                fr: "Rechercher des espaces...",
                de: "Bereiche suchen...",
                zh: "搜索空间…",
              })}
            />
          }
          filters={
            <>
              <UiSelect
                label={t({
                  en: "My role",
                  fr: "Mon rôle",
                  de: "Meine Rolle",
                  zh: "我的角色",
                })}
                size="compact"
                className="ui-list-control"
                value={roleFilter}
                onChange={(event) =>
                  setRoleFilter(
                    event.target.value as PortalStorageSpaceRole | "all",
                  )
                }
              >
                <option value="all">
                  {t({
                    en: "All roles",
                    fr: "Tous les rôles",
                    de: "Alle Rollen",
                    zh: "所有角色",
                  })}
                </option>
                <option value="Manager">{portalRoleLabel("Manager", t)}</option>
                <option value="Owner">{portalRoleLabel("Owner", t)}</option>
                <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
              </UiSelect>
              {activeTab === "active" ? (
                <div className="hidden md:block">
                  <UiSelect
                    label={t({
                      en: "Status",
                      fr: "Statut",
                      de: "Status",
                      zh: "状态",
                    })}
                    size="compact"
                    className="ui-list-control"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">
                      {t({
                        en: "All states",
                        fr: "Tous les états",
                        de: "Alle Status",
                        zh: "所有状态",
                      })}
                    </option>
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </UiSelect>
                </div>
              ) : null}
            </>
          }
          mobileSort={
            <div className="flex w-full flex-wrap gap-2 md:hidden">
              <UiButton
                variant="secondary"
                size="xs"
                className="min-h-11"
                aria-expanded={mobileListControlsOpen}
                aria-controls="portal-storage-spaces-mobile-controls"
                onClick={() => setMobileListControlsOpen((open) => !open)}
              >
                {mobileListControlsOpen
                  ? t({
                      en: "Hide filters & sort",
                      fr: "Masquer les filtres et le tri",
                      de: "Filter und Sortierung ausblenden",
                      zh: "隐藏筛选和排序",
                    })
                  : t({
                      en: "Filters & sort",
                      fr: "Filtres et tri",
                      de: "Filter und Sortierung",
                      zh: "筛选和排序",
                    })}
              </UiButton>
              {mobileListControlsOpen ? (
                <div
                  id="portal-storage-spaces-mobile-controls"
                  className="flex w-full flex-wrap items-center gap-2"
                >
                  {activeTab === "active" ? (
                    <UiSelect
                      label={t({
                        en: "Status",
                        fr: "Statut",
                        de: "Status",
                        zh: "状态",
                      })}
                      size="compact"
                      className="ui-list-control"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="all">
                        {t({
                          en: "All states",
                          fr: "Tous les états",
                          de: "Alle Status",
                          zh: "所有状态",
                        })}
                      </option>
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </UiSelect>
                  ) : null}
                  <TableSortControls
                    columns={storageSpaceColumns}
                    sort={tableSort}
                    labels={{
                      sortBy: t({
                        en: "Sort by",
                        fr: "Trier par",
                        de: "Sortieren nach",
                        zh: "排序依据",
                      }),
                      direction: t({
                        en: "Direction",
                        fr: "Ordre",
                        de: "Reihenfolge",
                        zh: "排序方向",
                      }),
                      ascending: t({
                        en: "Ascending",
                        fr: "Croissant",
                        de: "Aufsteigend",
                        zh: "升序",
                      }),
                      descending: t({
                        en: "Descending",
                        fr: "Décroissant",
                        de: "Absteigend",
                        zh: "降序",
                      }),
                    }}
                  />
                </div>
              ) : null}
            </div>
          }
        >
          <DataTableShell
            columns={storageSpaceColumns}
            sort={tableSort}
            rows={filteredSpaces}
            rowKey={(space) => space.id}
            status={tableStatus}
            loadingMessage={t({
              en: "Loading spaces...",
              fr: "Chargement des espaces...",
              de: "Bereiche werden geladen...",
              zh: "正在加载空间…",
            })}
            errorMessage={t({
              en: "Unable to load spaces.",
              fr: "Impossible de charger les espaces.",
              de: "Bereiche können nicht geladen werden.",
              zh: "无法加载空间。",
            })}
            emptyMessage={
              activeTab === "archived"
                ? t({
                    en: "No archived spaces.",
                    fr: "Aucun espace archivé.",
                    de: "Keine archivierten Bereiche.",
                    zh: "没有已归档空间。",
                  })
                : canCreate
                  ? t({
                      en: "No spaces yet. Create one to start storing files.",
                      fr: "Aucun espace pour l'instant. Créez-en un pour commencer à stocker des fichiers.",
                      de: "Noch keine Bereiche. Erstellen Sie einen, um Dateien zu speichern.",
                      zh: "暂无空间。创建一个即可开始存储文件。",
                    })
                  : t({
                      en: "No spaces are available. Ask an administrator to add you to a space or enable creation for your account.",
                      fr: "Aucun espace n'est disponible. Demandez à un administrateur de vous ajouter à un espace ou d'activer la création pour votre compte.",
                      de: "Es sind keine Bereiche verfügbar. Bitten Sie einen Administrator, Sie zu einem Bereich hinzuzufügen oder die Erstellung für Ihr Konto zu aktivieren.",
                      zh: "没有可用空间。请让管理员将你添加到空间，或为你的账户启用创建功能。",
                    })
            }
            responsiveCards
          />
        </ListPageSection>
      </PortalTabPanel>
    </>
  );
}
