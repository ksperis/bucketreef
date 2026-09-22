/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionLink } from "../../components/list/ListControls";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { PortalCollaborator } from "../../api/portalCollaborators";
import {
  listPortalStorageSpacePublicLinks,
  type PortalPublicLink,
} from "../../api/portalSharing";
import { createPortalRequest } from "../../api/portalRequests";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import { PortalMemberRequestFields } from "./PortalRequestFields";

import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UserAvatar from "../../components/UserAvatar";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiMutedTextClass,
  uiPanelMutedClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import PortalPublicLinkRevokeDialog from "./PortalPublicLinkRevokeDialog";
import PortalPublicLinksTable from "./PortalPublicLinksTable";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import {
  storageSpacePath,
} from "./portalWorkspaceModel";
import { resolvePortalWorkspacePageState } from "./portalUi";
import {
  portalAccessSourceLabel,
  portalAccountRoleLabel,
  portalDateLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { usePortalPublicLinkActions } from "./usePortalPublicLinkActions";

type CollaboratorsViewTab = "members" | "links";
type PendingShareAction = { type: "revoke-public-link"; link: PortalPublicLink };

function CollaboratorsInventory({
  collaborators,
  loading,
  error,
  query,
  onQueryChange,
}: {
  collaborators: PortalCollaborator[];
  loading: boolean;
  error?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { locale, t } = useI18n();
  const term = query.trim().toLowerCase();
  const visibleCollaborators = useMemo(
    () =>
      collaborators.filter((collaborator) => {
        if (!term) return true;
        return [
          collaborator.email,
          collaborator.display_name,
          collaborator.portal_role,
          collaborator.access_source,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      }),
    [collaborators, term],
  );
  const tableStatus: "loading" | "error" | "empty" | "ready" =
    loading && visibleCollaborators.length === 0
      ? "loading"
      : error && visibleCollaborators.length === 0
        ? "error"
        : visibleCollaborators.length === 0
          ? "empty"
          : "ready";
  const columns = useMemo<DataTableColumn<PortalCollaborator>[]>(
    () => [
      {
        id: "person",
        label: t({ en: "Person", fr: "Personne", de: "Person", zh: "人员" }),
        primary: true,
        render: (collaborator) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <UserAvatar
              avatar={collaborator.avatar}
              name={collaborator.display_name || collaborator.email}
              email={collaborator.email}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate">
                {collaborator.display_name || collaborator.email}
              </span>
              <span
                className={cx(
                  "block truncate text-[11px] font-medium",
                  uiMutedTextClass,
                )}
              >
                {collaborator.email}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "role",
        label: t({
          en: "Project role",
          fr: "Rôle projet",
          de: "Projektrolle",
          zh: "项目角色",
        }),
        render: (collaborator) => (
          <UiBadge
            tone={
              collaborator.portal_role === "portal_manager"
                ? "primary"
                : "neutral"
            }
          >
            {portalAccountRoleLabel(collaborator.portal_role, t)}
          </UiBadge>
        ),
      },
      {
        id: "source",
        label: t({ en: "Access", fr: "Accès", de: "Zugriff", zh: "访问权限" }),
        render: (collaborator) =>
          portalAccessSourceLabel(collaborator.access_source, t),
      },
      {
        id: "since",
        label: t({
          en: "Member since",
          fr: "Membre depuis",
          de: "Mitglied seit",
          zh: "加入时间",
        }),
        render: (collaborator) =>
          collaborator.member_since
            ? portalDateLabel(collaborator.member_since, locale)
            : "-",
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion", zh: "操作" }),
        align: "right" as const,
        mobileRole: "actions" as const,
        render: (collaborator) =>
          collaborator.can_review_access ? (
            <ListActionLink
              to={`/portal/shares/${encodeURIComponent(collaborator.user_id)}`}

              {...dataTableDefaultActionProps}
            >
              {t({
                en: "Review access",
                fr: "Revoir les accès",
                de: "Zugriff prüfen",
                zh: "审查访问权限",
              })}
            </ListActionLink>
          ) : (
            <span className={uiMutedTextClass}>-</span>
          ),
      },
    ],
    [locale, t],
  );

  return (
    <ListPageSection variant="page"
      title={t({
        en: "Project members",
        fr: "Membres du projet",
        de: "Projektmitglieder",
        zh: "项目成员",
      })}
      countLabel={t({
        en: `${visibleCollaborators.length} of ${collaborators.length} member${collaborators.length === 1 ? "" : "s"}`,
        fr: `${visibleCollaborators.length} sur ${collaborators.length} membre${collaborators.length > 1 ? "s" : ""}`,
        de: `${visibleCollaborators.length} von ${collaborators.length} Mitglied${collaborators.length === 1 ? "" : "ern"}`,
        zh: `共 ${collaborators.length} 名成员，显示 ${visibleCollaborators.length} 名`,
      })}
      search={
        <UiInput
            label={t({
              en: "Search members",
              fr: "Rechercher des membres",
              de: "Mitglieder suchen",
              zh: "搜索成员",
            })}
            size="compact"
            className="h-9"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t({
              en: "Name, email, or access source...",
              fr: "Nom, email ou source d'accès...",
              de: "Name, E-Mail oder Zugriffsquelle...",
              zh: "姓名、邮箱或访问来源…",
            })}
          />
      }
    >
      <DataTableShell
          columns={columns}
          rows={visibleCollaborators}
          rowKey={(collaborator) => collaborator.user_id}
          status={tableStatus}
          loadingMessage={t({
            en: "Loading project members...",
            fr: "Chargement des membres du projet...",
            de: "Projektmitglieder werden geladen...",
            zh: "正在加载项目成员…",
          })}
          errorMessage={
            error ??
            t({
              en: "Unable to load project members.",
              fr: "Impossible de charger les membres du projet.",
              de: "Projektmitglieder können nicht geladen werden.",
              zh: "无法加载项目成员。",
            })
          }
          emptyMessage={
            term
              ? t({
                  en: "No member matches this search.",
                  fr: "Aucun membre ne correspond à cette recherche.",
                  de: "Kein Mitglied passt zu dieser Suche.",
                  zh: "没有符合搜索条件的成员。",
                })
              : t({
                  en: "No project members to display.",
                  fr: "Aucun membre du projet à afficher.",
                  de: "Keine Projektmitglieder zum Anzeigen.",
                  zh: "没有可显示的项目成员。",
                })
          }
          responsiveCards
      />
    </ListPageSection>
  );
}

export default function PortalSharesPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeViewTab, setActiveViewTab] = useState<CollaboratorsViewTab>(
    searchParams.get("view") === "links" ? "links" : "members",
  );
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [selectedLinkSpaceId, setSelectedLinkSpaceId] = useState("");
  const [collaboratorQuery, setCollaboratorQuery] = useState("");
  const [sharesMessage, setSharesMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingShareAction | null>(
    null,
  );
  const [memberRequestOpen, setMemberRequestOpen] = useState(false);
  const [memberRequestName, setMemberRequestName] = useState("");
  const [memberRequestEmail, setMemberRequestEmail] = useState("");
  const [memberRequestReason, setMemberRequestReason] = useState("");
  const [memberRequestError, setMemberRequestError] = useState<string | null>(null);
  const [memberRequestBusy, setMemberRequestBusy] = useState(false);
  const {
    workspace,
    state,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    selectedAccount,
    collaborators,
    collaboratorsLoading,
    collaboratorsError,
  } = usePortalWorkspaceData({ includeCollaborators: true });
  const canRequestMemberChanges = Boolean(
    selectedAccount?.portal_role === "portal_manager" ||
      state?.portal_role === "portal_manager" ||
      state?.can_manage_portal_users,
  );
  const activeCollaboratorSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status !== "Archived"),
    [workspace.spaces],
  );
  const activeManagedTeamSpaces = useMemo(
    () => activeCollaboratorSpaces.filter((space) => space.role === "Manager" && space.visibility === "shared"),
    [activeCollaboratorSpaces],
  );

  const selectedPublicLinkSpace =
    activeManagedTeamSpaces.find((space) => space.id === selectedLinkSpaceId) ??
    null;
  const updateLinksAfterRevoke = useCallback(
    (updated: PortalPublicLink[], link: PortalPublicLink) =>
      setPublicLinks((current) => [
        ...current.filter(
          (item) => item.storage_space_id !== link.storage_space_id,
        ),
        ...updated,
      ]),
    [],
  );
  const {
    busyLinkId: busyPublicLinkId,
    copyLink: copyPublicLink,
    revokeLink: revokePublicLink,
  } = usePortalPublicLinkActions({
    accountId: accountIdForApi,
    onLinksUpdated: updateLinksAfterRevoke,
    onMessage: setSharesMessage,
    onError: setSharesError,
  });

  useEffect(() => {
    const requestedSpaceId = searchParams.get("space_id");
    if (requestedSpaceId && workspace.spaces.some((space) => space.id === requestedSpaceId)) {
      setSelectedLinkSpaceId(requestedSpaceId);
    }
  }, [searchParams, workspace.spaces]);

  useEffect(() => {
    if (selectedLinkSpaceId && !activeManagedTeamSpaces.some((space) => space.id === selectedLinkSpaceId)) {
      setSelectedLinkSpaceId("");
    }
  }, [activeManagedTeamSpaces, selectedLinkSpaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || activeManagedTeamSpaces.length === 0) {
      setPublicLinks([]);
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      activeManagedTeamSpaces.map((space) =>
        listPortalStorageSpacePublicLinks(accountIdForApi, space.id, {
          includeRevoked: true,
        }),
      ),
    )
      .then((results) => {
        if (!cancelled) setPublicLinks(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setPublicLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeManagedTeamSpaces]);

  const handleRevokePublicLink = useCallback(
    (link: PortalPublicLink) => {
      if (!accountIdForApi) return;
      setPendingAction({ type: "revoke-public-link", link });
    },
    [accountIdForApi],
  );

  const closeMemberRequest = () => {
    if (memberRequestBusy) return;
    setMemberRequestOpen(false);
    setMemberRequestName("");
    setMemberRequestEmail("");
    setMemberRequestReason("");
    setMemberRequestError(null);
  };

  const handleMemberRequest = async (event: FormEvent) => {
    event.preventDefault();
    const targetName = memberRequestName.trim();
    const targetEmail = memberRequestEmail.trim();
    if (!accountIdForApi || !canRequestMemberChanges || !targetName || !targetEmail) return;
    setMemberRequestBusy(true);
    setMemberRequestError(null);
    setSharesError(null);
    setSharesMessage(null);
    try {
      await createPortalRequest(accountIdForApi, {
        request_type: "portal_user_access",
        target_name: targetName,
        target_email: targetEmail,
        reason: memberRequestReason.trim() || null,
      });
      setMemberRequestOpen(false);
      setMemberRequestName("");
      setMemberRequestEmail("");
      setMemberRequestReason("");
      setSharesMessage(
        t({
          en: "Member request sent. Track it in Help requests.",
          fr: "Demande d'ajout envoyée. Suivez-la dans la page Demandes.",
          de: "Mitgliedsanfrage gesendet. Verfolgen Sie sie unter Hilfeanfragen.",
          zh: "成员请求已发送。可在“帮助请求”中查看进度。",
        }),
      );
    } catch (err) {
      console.error(err);
      setMemberRequestError(
        extractApiError(
          err,
          t({
            en: "Unable to send the member request.",
            fr: "Impossible d'envoyer la demande d'ajout.",
            de: "Mitgliedsanfrage kann nicht gesendet werden.",
            zh: "无法发送成员请求。",
          }),
        ),
      );
    } finally {
      setMemberRequestBusy(false);
    }
  };

  const publicLinkRows = useMemo(
    () =>
      publicLinks
        .filter(
          (link) =>
            !selectedLinkSpaceId ||
            link.storage_space_id === selectedLinkSpaceId,
        ),
    [publicLinks, selectedLinkSpaceId],
  );
  const activePublicLinkCount = publicLinkRows.filter(
    (link) => link.status === "Active",
  ).length;
  const publicLinksTableStatus =
    publicLinkRows.length === 0 ? "empty" : "ready";
  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({
      en: "Loading collaborators...",
      fr: "Chargement des collaborateurs...",
      de: "Mitwirkende werden geladen...",
      zh: "正在加载协作者…",
    }),
    noAccountMessage: t({
      en: "Select a project to manage collaborators.",
      fr: "Sélectionnez un projet pour gérer les collaborateurs.",
      de: "Wählen Sie ein Projekt aus, um Mitwirkende zu verwalten.",
      zh: "选择项目以管理协作者。",
    }),
  });
  if (pageState) return pageState;

  return (
    <PageShell actionPresentation="listing"
        title={t({
          en: "Collaborators",
          fr: "Collaborateurs",
          de: "Mitwirkende",
          zh: "协作者",
        })}
        description={t({
          en: "Review project members and track links shared outside the project.",
          fr: "Revoyez les membres du projet et suivez les liens partagés à l'extérieur.",
          de: "Prüfen Sie Projektmitglieder und verfolgen Sie extern geteilte Links.",
          zh: "审查项目成员并跟踪共享到项目外部的链接。",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({
            en: "Collaborators",
            fr: "Collaborateurs",
            de: "Mitwirkende",
            zh: "协作者",
          }),
        })}
        actions={[
          ...(canRequestMemberChanges
            ? [
                {
                  label: t({
                    en: "Request member",
                    fr: "Demander un membre",
                    de: "Mitglied anfragen",
                    zh: "申请添加成员",
                  }),
                  onClick: () => {
                    setMemberRequestError(null);
                    setMemberRequestOpen(true);
                  },
                  variant: "primary" as const,
                  disabled: memberRequestBusy,
                },
              ]
            : []),
          {
            label: t({
              en: "Open spaces",
              fr: "Ouvrir les espaces",
              de: "Bereiche öffnen",
              zh: "打开空间列表",
            }),
            to: "/portal/storage-spaces",
          },
        ]}
    >
      {sharesError ? (
        <PageBanner tone="warning">{sharesError}</PageBanner>
      ) : null}
      {sharesMessage ? (
        <PageBanner tone="success">{sharesMessage}</PageBanner>
      ) : null}

      <PortalPageTabs
        tabs={[
          {
            id: "members",
            label: t({
              en: "Project members",
              fr: "Membres du projet",
              de: "Projektmitglieder",
              zh: "项目成员",
            }),
          },
          {
            id: "links",
            label: t({
              en: "External links",
              fr: "Liens externes",
              de: "Externe Links",
              zh: "外部链接",
            }),
          },
        ]}
        activeTab={activeViewTab}
        onChange={(tab) => {
          const nextTab = tab as CollaboratorsViewTab;
          const nextParams = new URLSearchParams(searchParams);
          if (nextTab === "links") nextParams.set("view", "links");
          else nextParams.delete("view");
          setActiveViewTab(nextTab);
          setSearchParams(nextParams, { replace: true });
        }}
        ariaLabel={t({
          en: "Collaborator overview",
          fr: "Vue d'ensemble des collaborateurs",
          de: "Mitwirkendenübersicht",
          zh: "协作者概览",
        })}
        idPrefix="portal-collaborators"
      />

      {activeViewTab === "members" ? (
        <PortalTabPanel
          idPrefix="portal-collaborators"
          tabId="members"
        >
          <CollaboratorsInventory
            collaborators={collaborators?.collaborators ?? []}
            loading={collaboratorsLoading}
            error={collaboratorsError}
            query={collaboratorQuery}
            onQueryChange={setCollaboratorQuery}
          />
        </PortalTabPanel>
      ) : null}

      {activeViewTab === "links" ? (
        <PortalTabPanel idPrefix="portal-collaborators" tabId="links">
          <UiCard>
            <div className="space-y-3">
            <section
              className={cx(uiPanelMutedClass, "p-4")}
              aria-labelledby="portal-public-link-guidance-title"
            >
              <h2 id="portal-public-link-guidance-title" className="ui-subtitle">
                {t({
                  en: "Create links from a file",
                  fr: "Créer les liens depuis un fichier",
                  de: "Links aus einer Datei erstellen",
                  zh: "从文件创建链接",
                })}
              </h2>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Public links are created from file actions. Use this overview to copy or revoke existing links.",
                  fr: "Les liens publics se créent depuis les actions d'un fichier. Utilisez cette vue pour copier ou révoquer les liens existants.",
                  de: "Öffentliche Links werden über Dateiaktionen erstellt. In dieser Übersicht können Sie vorhandene Links kopieren oder widerrufen.",
                  zh: "请通过文件操作创建公开链接。在此概览中可复制或撤销现有链接。",
                })}
              </p>
              {activeManagedTeamSpaces.length > 0 ? (
                <div className="mt-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
                  <UiSelect
                    label={t({ en: "Filter by space", fr: "Filtrer par espace", de: "Nach Bereich filtern", zh: "按空间筛选" })}
                    size="compact"
                    className="h-9"
                    value={selectedLinkSpaceId}
                    onChange={(event) => setSelectedLinkSpaceId(event.target.value)}
                  >
                    <option value="">
                      {t({ en: "All spaces", fr: "Tous les espaces", de: "Alle Bereiche", zh: "所有空间" })}
                    </option>
                    {activeManagedTeamSpaces.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </UiSelect>
                  <div className={cx("self-center text-xs font-medium", uiMutedTextClass)}>
                    {t({
                      en: `${activePublicLinkCount} active link${activePublicLinkCount === 1 ? "" : "s"} in this view`,
                      fr: `${activePublicLinkCount} lien${activePublicLinkCount > 1 ? "s" : ""} actif${activePublicLinkCount > 1 ? "s" : ""} dans cette vue`,
                      de: `${activePublicLinkCount} aktive Link${activePublicLinkCount === 1 ? "" : "s"} in dieser Ansicht`,
                      zh: `当前视图中有 ${activePublicLinkCount} 个有效链接`,
                    })}
                  </div>
                  <Link
                    to={
                      selectedPublicLinkSpace
                        ? `${storageSpacePath(selectedPublicLinkSpace)}#space-files`
                        : "/portal/storage-spaces"
                    }
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.primary,
                      "h-9 px-3 py-1.5 text-xs",
                    )}
                  >
                    {selectedPublicLinkSpace
                      ? t({ en: "Open files", fr: "Ouvrir les fichiers", de: "Dateien öffnen", zh: "打开文件" })
                      : t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen", zh: "打开空间列表" })}
                  </Link>
                </div>
              ) : (
                <PageBanner tone="info">
                  {t({
                    en: "Only project managers can create public links from active team spaces.",
                    fr: "Seuls les gestionnaires du projet peuvent créer des liens publics depuis les espaces d'équipe actifs.",
                    de: "Nur Projektmanager können öffentliche Links aus aktiven Teambereichen erstellen.",
                    zh: "只有项目管理员可以为活跃团队空间创建公开链接。",
                  })}
                </PageBanner>
              )}
            </section>
            <PortalPublicLinksTable
              links={publicLinkRows}
              status={publicLinksTableStatus}
              busyLinkId={busyPublicLinkId}
              showSpaceColumn
              showCopyForInactive
              expirationFormat="date"
              copyLabel={t({ en: "Copy", fr: "Copier", de: "Kopieren", zh: "复制" })}
              onCopy={copyPublicLink}
              onRevoke={handleRevokePublicLink}
              emptyMessage={t({
                en: "No external links in this view.",
                fr: "Aucun lien externe dans cette vue.",
                de: "Keine externen Links in dieser Ansicht.",
                zh: "当前视图中没有外部链接。",
              })}
            />
            </div>
          </UiCard>
        </PortalTabPanel>
      ) : null}

      {memberRequestOpen ? (
        <SettingsFormDialog
          title={t({ en: "Request a project member", fr: "Demander l'ajout d'un membre", de: "Projektmitglied anfragen", zh: "申请添加项目成员" })}
          draftKey={JSON.stringify([memberRequestName, memberRequestEmail, memberRequestReason])}
          busy={memberRequestBusy}
          disabled={!canRequestMemberChanges || !memberRequestName.trim() || !memberRequestEmail.trim()}
          error={memberRequestError}
          submitLabel={t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden", zh: "发送请求" })}
          onSubmit={handleMemberRequest}
          onClose={closeMemberRequest}
        >
          <PortalMemberRequestFields name={memberRequestName} email={memberRequestEmail} reason={memberRequestReason}
            onNameChange={setMemberRequestName} onEmailChange={setMemberRequestEmail} onReasonChange={setMemberRequestReason}
            disabled={memberRequestBusy} />
        </SettingsFormDialog>
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <PortalPublicLinkRevokeDialog
          link={pendingAction.link}
          loading={busyPublicLinkId === pendingAction.link.id}
          onCancel={() => setPendingAction(null)}
          onConfirm={() =>
            void revokePublicLink(pendingAction.link).finally(() =>
              setPendingAction(null),
            )
          }
        />
      ) : null}
    </PageShell>
  );
}
