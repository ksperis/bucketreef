/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState, type ReactNode } from "react";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import PageShell from "../../components/PageShell";

import UiBadge from "../../components/ui/UiBadge";
import UiButton, { UiButtonLink } from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import {
  readClientStorageKey,
  writeClientStorageKey,
} from "../../utils/clientStorage";
import {
  PortalAccessModeFields,
  PortalShareCandidatePicker,
  portalAccessModeDescription,
  portalAccessModeSummary,
} from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpacePath } from "./portalWorkspaceModel";
import { resolvePortalWorkspacePageState } from "./portalUi";
import PortalStorageSpacesList from "./PortalStorageSpacesList";
import { usePortalStorageSpaceProvisioning } from "./usePortalStorageSpaceProvisioning";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function StartStep({
  step,
  title,
  description,
  action,
}: {
  step: string;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <li className="flex min-h-[144px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
      <div>
        <div
          className={cx(
            "text-[11px] font-semibold uppercase",
            uiMutedTextClass,
          )}
        >
          {step}
        </div>
        <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
          {title}
        </h3>
        <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
          {description}
        </p>
      </div>
      <div className="mt-3">{action}</div>
    </li>
  );
}

export default function PortalStorageSpacesPage() {
  const { t } = useI18n();
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    state,
  } = usePortalWorkspaceData({
    includeArchived: true,
    includeUsage: true,
  });
  const [startGuideDismissed, setStartGuideDismissed] = useState(false);

  const canCreatePrivate = Boolean(state?.can_create_private_storage_spaces);
  const canCreateTeam = Boolean(state?.can_create_team_storage_spaces);
  const canCreate = canCreatePrivate || canCreateTeam;
  const canImport =
    state?.portal_role === "portal_manager" &&
    Boolean(state?.can_manage_buckets);
  const canUseNamedBucket = Boolean(state?.allow_named_bucket_create);
  const {
    candidates: {
      items: shareCandidates,
      loading: shareCandidatesLoading,
      error: shareCandidatesError,
      portalMemberCount,
    },
    create: {
      open: showCreate,
      openDialog: openCreate,
      closeDialog: closeCreate,
      accessModes: createAccessModes,
      name: newName,
      setName: setNewName,
      description: newDescription,
      setDescription: setNewDescription,
      accessMode: newAccessMode,
      setAccessMode: setNewAccessMode,
      effectiveAccessMode: effectiveNewAccessMode,
      accountMemberRole: newAccountMemberRole,
      setAccountMemberRole: setNewAccountMemberRole,
      namingMode: newNamingMode,
      setNamingMode: setNewNamingMode,
      effectiveNamingMode,
      restrictedRolesByUserId,
      setRestrictedRole: setCreateRestrictedRole,
      candidateQuery: shareCandidateQuery,
      setCandidateQuery: setShareCandidateQuery,
      selectedRestrictedEntries,
      formSignature: createFormSignature,
      busy: createBusy,
      error: createError,
      nameError: newNameError,
      submit: handleCreate,
    },
    importFlow: {
      open: showImport,
      openDialog: openImport,
      closeDialog: closeImport,
      accessModes: importAccessModes,
      bucketName: importBucketName,
      setBucketName: setImportBucketName,
      description: importDescription,
      setDescription: setImportDescription,
      accessMode: importAccessMode,
      setAccessMode: setImportAccessMode,
      accountMemberRole: importAccountMemberRole,
      setAccountMemberRole: setImportAccountMemberRole,
      restrictedRolesByUserId: importRestrictedRolesByUserId,
      setRestrictedRole: setImportRestrictedRole,
      candidateQuery: importShareCandidateQuery,
      setCandidateQuery: setImportShareCandidateQuery,
      selectedRestrictedEntries: selectedImportRestrictedEntries,
      formSignature: importFormSignature,
      busy: importBusy,
      error: importError,
      submit: handleImport,
    },
  } = usePortalStorageSpaceProvisioning({
    accountId: accountIdForApi,
    canCreatePrivate,
    canCreateTeam,
    canImport,
    canUseNamedBucket,
  });
  const firstActiveSpace =
    workspace.spaces.find((space) => space.status !== "Archived") ?? null;
  const firstWritableSpace =
    workspace.spaces.find(
      (space) =>
        space.status !== "Archived" &&
        (space.role === "Manager" ||
          space.role === "Owner" ||
          space.role === "Editor"),
    ) ?? firstActiveSpace;
  const firstManagedTeamSpace =
    workspace.spaces.find(
      (space) =>
        space.status !== "Archived" &&
        space.role === "Manager" &&
        space.visibility === "shared",
    ) ?? null;
  const startGuideStorageKey = `portal.storage-spaces.start-guide.dismissed.${accountIdForApi ?? "default"}`;

  useEffect(() => {
    setStartGuideDismissed(
      readClientStorageKey(startGuideStorageKey) === "1",
    );
  }, [startGuideStorageKey]);

  const dismissStartGuide = () => {
    writeClientStorageKey(startGuideStorageKey, "1");
    setStartGuideDismissed(true);
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({
      en: "Loading spaces...",
      fr: "Chargement des espaces...",
      de: "Bereiche werden geladen...",
      zh: "正在加载空间…",
    }),
    noAccountMessage: t({
      en: "Select a project to view spaces.",
      fr: "Sélectionnez un projet pour voir les espaces.",
      de: "Wählen Sie ein Projekt aus, um Bereiche anzuzeigen.",
      zh: "选择项目以查看空间。",
    }),
  });
  if (pageState) return pageState;
  const headerActions = [
    ...(canCreate
      ? [
          {
            label: t({
              en: "Create space",
              fr: "Créer un espace",
              de: "Bereich erstellen",
              zh: "创建空间",
            }),
            onClick: openCreate,
          },
        ]
      : []),
    ...(canImport
      ? [
          {
            label: t({
              en: "Add existing space",
              fr: "Ajouter un espace existant",
              de: "Vorhandenen Bereich hinzufügen",
              zh: "添加现有空间",
            }),
            onClick: openImport,
            variant: "secondary" as const,
          },
        ]
      : []),
  ];
  const showStartGuide = workspace.spaces.length === 0 && !startGuideDismissed;
  return (
    <PageShell actionPresentation="listing"
      title={t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" })}
      description={t({
        en: "Create places for project files, upload data, and invite collaborators.",
        fr: "Créez des espaces pour les fichiers de projet, ajoutez des données et invitez des collaborateurs.",
        de: "Erstellen Sie Bereiche für Projektdateien, laden Sie Daten hoch und laden Sie Mitwirkende ein.",
        zh: "为项目文件创建空间、上传数据并邀请协作者。",
      })}
      breadcrumbs={portalBreadcrumbs({
        label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" }),
      })}
      actions={headerActions}
    >

      {showStartGuide ? (
        <section
          className={cx(uiPanelMutedClass, "p-4")}
          aria-labelledby="portal-spaces-start-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div
                className={cx(
                  "text-[11px] font-semibold uppercase",
                  uiMutedTextClass,
                )}
              >
                {t({
                  en: "Start here",
                  fr: "Commencer ici",
                  de: "Hier starten",
                  zh: "从这里开始",
                })}
              </div>
              <h2
                id="portal-spaces-start-title"
                className={cx("mt-1 text-[15px] font-bold", uiTitleTextClass)}
              >
                {t({
                  en: "Create, fill, and share a space",
                  fr: "Créer, remplir et partager un espace",
                  de: "Bereich erstellen, füllen und teilen",
                  zh: "创建空间、添加内容并共享",
                })}
              </h2>
              <p
                className={cx(
                  "mt-1 max-w-3xl text-xs leading-5",
                  uiMutedTextClass,
                )}
              >
                {t({
                  en: "Use spaces as project rooms: create one, add files, then bring collaborators in when the content is ready.",
                  fr: "Utilisez les espaces comme des salles de projet : créez-en un, ajoutez des fichiers, puis invitez les collaborateurs quand le contenu est prêt.",
                  de: "Nutzen Sie Bereiche wie Projekträume: Erstellen Sie einen, fügen Sie Dateien hinzu und laden Sie Mitwirkende ein, sobald die Inhalte bereit sind.",
                  zh: "将空间用作项目资料室：创建空间、添加文件，然后在内容准备就绪后邀请协作者。",
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <UiBadge tone="warning">
                {t({
                  en: "No spaces yet",
                  fr: "Aucun espace",
                  de: "Noch keine Bereiche",
                  zh: "暂无空间",
                })}
              </UiBadge>
              <UiButton size="xs" variant="ghost" onClick={dismissStartGuide}>
                {t({
                  en: "Dismiss guide",
                  fr: "Masquer le guide",
                  de: "Anleitung ausblenden",
                  zh: "关闭指引",
                })}
              </UiButton>
            </div>
          </div>
          <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StartStep
              step={t({ en: "Step 1", fr: "Étape 1", de: "Schritt 1", zh: "第 1 步" })}
              title={t({
                en: "Set up a space",
                fr: "Configurer un espace",
                de: "Bereich einrichten",
                zh: "设置空间",
              })}
              description={t({
                en: "Name the project, dataset, or team room where files will live.",
                fr: "Nommez le projet, le jeu de données ou l'espace d'équipe où les fichiers seront rangés.",
                de: "Benennen Sie das Projekt, den Datensatz oder Teamraum, in dem Dateien liegen werden.",
                zh: "为存放文件的项目、数据集或团队空间命名。",
              })}
              action={
                canCreate ? (
                  <UiButton
                    size="sm"
                    onClick={openCreate}
                  >
                    {t({
                      en: "Start a new space",
                      fr: "Démarrer un nouvel espace",
                      de: "Neuen Bereich starten",
                      zh: "新建空间",
                    })}
                  </UiButton>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "Ask to be added",
                      fr: "Demander un accès",
                      de: "Zugriff anfragen",
                      zh: "申请加入",
                    })}
                  </span>
                )
              }
            />
            <StartStep
              step={t({ en: "Step 2", fr: "Étape 2", de: "Schritt 2", zh: "第 2 步" })}
              title={t({
                en: "Upload files",
                fr: "Ajouter des fichiers",
                de: "Dateien hochladen",
                zh: "上传文件",
              })}
              description={t({
                en: "Open a space and use its file area to add folders or data.",
                fr: "Ouvrez un espace et utilisez sa zone de fichiers pour ajouter des dossiers ou des données.",
                de: "Öffnen Sie einen Bereich und nutzen Sie den Dateibereich, um Ordner oder Daten hinzuzufügen.",
                zh: "打开空间，在文件区域中添加文件夹或数据。",
              })}
              action={
                firstWritableSpace ? (
                  <UiButtonLink
                    to={`${storageSpacePath(firstWritableSpace)}#space-files`}
                    size="sm"
                    variant="secondary"
                  >
                    {t({
                      en: "Open files",
                      fr: "Ouvrir les fichiers",
                      de: "Dateien öffnen",
                      zh: "打开文件",
                    })}
                  </UiButtonLink>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "Create a space first",
                      fr: "Créez d'abord un espace",
                      de: "Zuerst Bereich erstellen",
                      zh: "请先创建空间",
                    })}
                  </span>
                )
              }
            />
            <StartStep
              step={t({ en: "Step 3", fr: "Étape 3", de: "Schritt 3", zh: "第 3 步" })}
              title={t({
                en: "Invite people",
                fr: "Inviter des personnes",
                de: "Personen einladen",
                zh: "邀请人员",
              })}
              description={t({
                en: "Managers can give internal collaborators Viewer or Editor access to team spaces.",
                fr: "Les gestionnaires peuvent donner aux collaborateurs un accès Lecteur ou Éditeur aux espaces d'équipe.",
                de: "Manager können internen Mitwirkenden Viewer- oder Editor-Zugriff auf Teambereiche geben.",
                zh: "管理员可以向内部协作者授予团队空间的查看者或编辑者权限。",
              })}
              action={
                firstManagedTeamSpace ? (
                  <UiButtonLink
                    to={`/portal/storage-spaces/${encodeURIComponent(firstManagedTeamSpace.id)}?tab=collaborators`}
                    size="sm"
                    variant="secondary"
                  >
                    {t({ en: "Invite people", fr: "Inviter", de: "Einladen", zh: "邀请人员" })}
                  </UiButtonLink>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "A managed team space is needed",
                      fr: "Un espace d'équipe géré est requis",
                      de: "Ein verwalteter Teambereich ist erforderlich",
                      zh: "需要受管理的团队空间",
                    })}
                  </span>
                )
              }
            />
            <StartStep
              step={t({ en: "Step 4", fr: "Étape 4", de: "Schritt 4", zh: "第 4 步" })}
              title={t({
                en: "Share a file",
                fr: "Partager un fichier",
                de: "Datei teilen",
                zh: "共享文件",
              })}
              description={t({
                en: "Choose a file from the space to create an external link only when it is needed.",
                fr: "Choisissez un fichier depuis l'espace pour créer un lien externe uniquement si nécessaire.",
                de: "Wählen Sie bei Bedarf eine Datei im Bereich aus, um einen externen Link zu erstellen.",
                zh: "仅在需要时，从空间中选择文件并创建外部链接。",
              })}
              action={
                firstManagedTeamSpace ? (
                  <UiButtonLink
                    to={`${storageSpacePath(firstManagedTeamSpace)}#space-files`}
                    size="sm"
                    variant="secondary"
                  >
                    {t({
                      en: "Choose file",
                      fr: "Choisir un fichier",
                      de: "Datei wählen",
                      zh: "选择文件",
                    })}
                  </UiButtonLink>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "A managed team space is needed",
                      fr: "Un espace d'équipe géré est requis",
                      de: "Ein verwalteter Teambereich ist erforderlich",
                      zh: "需要受管理的团队空间",
                    })}
                  </span>
                )
              }
            />
          </ol>
        </section>
      ) : null}

      {showCreate ? (
        <SettingsFormDialog
          title={t({
            en: "Create a space",
            fr: "Créer un espace",
            de: "Bereich erstellen",
            zh: "创建空间",
          })}
          onClose={closeCreate}
          draftKey={createFormSignature}
          busy={createBusy}
          disabled={!canCreate}
          noValidate
          error={createError}
          onSubmit={handleCreate}
          submitLabel={t({ en: "Create", fr: "Créer", de: "Erstellen", zh: "创建" })}
          maxWidthClass="max-w-3xl"
          maxBodyHeightClass="max-h-[80vh]"
        >
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {t({
              en: "Name the place first. You can upload files and invite collaborators right after it opens.",
              fr: "Nommez d'abord l'espace. Vous pourrez ajouter des fichiers et inviter des collaborateurs dès son ouverture.",
              de: "Benennen Sie zuerst den Bereich. Danach können Sie Dateien hochladen und Mitwirkende einladen.",
              zh: "先为空间命名。打开后即可上传文件并邀请协作者。",
            })}
          </p>
          <div
            className={cx(
              "grid gap-3",
              canUseNamedBucket
                ? "lg:grid-cols-[180px_1fr_1.5fr]"
                : "lg:grid-cols-[1fr_1.5fr]",
            )}
          >
            {canUseNamedBucket ? (
              <UiSelect
                label={t({
                  en: "Space setup",
                  fr: "Configuration de l'espace",
                  de: "Bereich einrichten",
                  zh: "空间设置",
                })}
                size="compact"
                value={newNamingMode}
                onChange={(event) =>
                  setNewNamingMode(
                    event.target.value as "generic_uuid" | "named_bucket",
                  )
                }
              >
                <option value="generic_uuid">
                  {t({
                    en: "Let Portal choose the ID",
                    fr: "Laisser Portal choisir l'identifiant",
                    de: "Portal wählt die ID",
                    zh: "由 Portal 选择 ID",
                  })}
                </option>
                <option value="named_bucket">
                  {t({
                    en: "Use a custom tool ID",
                    fr: "Utiliser un identifiant d'outil",
                    de: "Eigene Werkzeug-ID nutzen",
                    zh: "使用自定义工具 ID",
                  })}
                </option>
              </UiSelect>
            ) : null}
            <UiInput
              label={
                effectiveNamingMode === "named_bucket"
                  ? t({
                      en: "Space name and tool ID",
                      fr: "Nom de l'espace et identifiant d'outil",
                      de: "Bereichsname und Werkzeug-ID",
                      zh: "空间名称和工具 ID",
                    })
                  : t({
                      en: "Space name",
                      fr: "Nom de l'espace",
                      de: "Name des Bereichs",
                      zh: "空间名称",
                    })
              }
              size="compact"
              value={newName}
              required
              error={newNameError}
              spellCheck={effectiveNamingMode !== "named_bucket"}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={
                effectiveNamingMode === "named_bucket"
                  ? t({
                      en: "Project or dataset ID",
                      fr: "Identifiant du projet ou du jeu de données",
                      de: "Projekt- oder Datensatz-ID",
                      zh: "项目或数据集 ID",
                    })
                  : t({
                      en: "Project, team, or dataset name",
                      fr: "Nom du projet, de l'équipe ou du jeu de données",
                      de: "Projekt-, Team- oder Datensatzname",
                      zh: "项目、团队或数据集名称",
                    })
              }
            />
            <UiInput
              label={t({
                en: "Description",
                fr: "Description",
                de: "Beschreibung",
                zh: "描述",
              })}
              size="compact"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder={t({
                en: "Description",
                fr: "Description",
                de: "Beschreibung",
                zh: "描述",
              })}
            />
          </div>
          <div className="space-y-3">
            {createAccessModes.length > 1 ? (
              <PortalAccessModeFields
                mode={newAccessMode}
                onModeChange={setNewAccessMode}
                accountMemberRole={newAccountMemberRole}
                onAccountMemberRoleChange={setNewAccountMemberRole}
                allowedModes={createAccessModes}
                modeLabel={t({
                  en: "Who can access this space?",
                  fr: "Qui peut accéder à cet espace ?",
                  de: "Wer kann auf diesen Bereich zugreifen?",
                  zh: "谁可以访问此空间？",
                })}
                roleLabel={t({
                  en: "Default role for team members",
                  fr: "Rôle par défaut des membres",
                  de: "Standardrolle für Teammitglieder",
                  zh: "团队成员默认角色",
                })}
              />
            ) : (
              <div className={cx("text-xs font-medium", uiMutedTextClass)}>
                {portalAccessModeDescription("private", t)}
              </div>
            )}
            {effectiveNewAccessMode !== "restricted" && <div
              className={cx("text-[11px] font-semibold", uiMutedTextClass)}
            >
              {portalAccessModeSummary(
                effectiveNewAccessMode,
                selectedRestrictedEntries.length,
                portalMemberCount,
                t,
              )}
            </div>}
          </div>
          {effectiveNewAccessMode === "restricted" ? (
            <PortalShareCandidatePicker
              candidates={shareCandidates}
              selectedRolesByUserId={restrictedRolesByUserId}
              query={shareCandidateQuery}
              loading={shareCandidatesLoading}
              error={shareCandidatesError}
              onQueryChange={setShareCandidateQuery}
              onRoleChange={setCreateRestrictedRole}
            />
          ) : null}
        </SettingsFormDialog>
      ) : null}

      {showImport ? (
        <SettingsFormDialog
          title={t({
            en: "Add existing space",
            fr: "Ajouter un espace existant",
            de: "Vorhandenen Bereich hinzufügen",
            zh: "添加现有空间",
          })}
          onClose={closeImport}
          draftKey={importFormSignature}
          busy={importBusy}
          disabled={!canImport || !importBucketName.trim()}
          error={importError}
          onSubmit={handleImport}
          submitLabel={t({ en: "Add", fr: "Ajouter", de: "Hinzufügen", zh: "添加" })}
          maxWidthClass="max-w-3xl"
          maxBodyHeightClass="max-h-[80vh]"
        >
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {t({
              en: "Attach existing storage to Portal and define its initial access.",
              fr: "Rattachez un stockage existant à Portal et définissez ses accès initiaux.",
              de: "Binden Sie vorhandenen Speicher an Portal an und legen Sie den anfänglichen Zugriff fest.",
              zh: "将现有存储接入 Portal，并定义其初始访问权限。",
            })}
          </p>
          <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr]">
            <UiInput
              label={t({
                en: "Existing technical ID",
                fr: "Identifiant technique existant",
                de: "Vorhandene technische ID",
                zh: "现有技术 ID",
              })}
              size="compact"
              value={importBucketName}
              onChange={(event) => setImportBucketName(event.target.value)}
              placeholder={t({
                en: "Existing technical ID",
                fr: "Identifiant technique existant",
                de: "Vorhandene technische ID",
                zh: "现有技术 ID",
              })}
            />
            <UiInput
              label={t({
                en: "Description",
                fr: "Description",
                de: "Beschreibung",
                zh: "描述",
              })}
              size="compact"
              value={importDescription}
              onChange={(event) => setImportDescription(event.target.value)}
              placeholder={t({
                en: "Description",
                fr: "Description",
                de: "Beschreibung",
                zh: "描述",
              })}
            />
          </div>
          <div className="space-y-3">
            <PortalAccessModeFields
              mode={importAccessMode}
              onModeChange={setImportAccessMode}
              accountMemberRole={importAccountMemberRole}
              onAccountMemberRoleChange={setImportAccountMemberRole}
              allowedModes={importAccessModes}
              modeLabel={t({
                en: "Who can access this space?",
                fr: "Qui peut accéder à cet espace ?",
                de: "Wer kann auf diesen Bereich zugreifen?",
                zh: "谁可以访问此空间？",
              })}
              roleLabel={t({
                en: "Default role for team members",
                fr: "Rôle par défaut des membres",
                de: "Standardrolle für Teammitglieder",
                zh: "团队成员默认角色",
              })}
            />
            {importAccessMode !== "restricted" && <div
              className={cx("text-[11px] font-semibold", uiMutedTextClass)}
            >
              {portalAccessModeSummary(
                importAccessMode,
                selectedImportRestrictedEntries.length,
                portalMemberCount,
                t,
              )}
            </div>}
          </div>
          {importAccessMode === "restricted" ? (
            <PortalShareCandidatePicker
              candidates={shareCandidates}
              selectedRolesByUserId={importRestrictedRolesByUserId}
              query={importShareCandidateQuery}
              loading={shareCandidatesLoading}
              error={shareCandidatesError}
              onQueryChange={setImportShareCandidateQuery}
              onRoleChange={setImportRestrictedRole}
            />
          ) : null}
        </SettingsFormDialog>
      ) : null}

      <PortalStorageSpacesList spaces={workspace.spaces} canCreate={canCreate} />
    </PageShell>
  );
}
