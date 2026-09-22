/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActions, ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createPortalAccessKey,
  deletePortalAccessKey,
  fetchPortalAccessKeysState,
  updatePortalAccessKeyStatus,
  type PortalAccessKey,
  type PortalAccessKeyCreate,
  type PortalAccessKeysState,
} from "../../api/portalAccessKeys";
import type { PortalStorageSpaceSummary } from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { cx } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import { bucketNameForPortalExternalTool } from "./portalExternalToolAccess";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalAccessKeyStatusLabel, portalDateTimeLabel } from "./portalI18n";

import PortalToolAccessCreateWorkflow, { type PortalToolAccessCreateOptions } from "./PortalToolAccessCreateWorkflow";
import { keyTargetLabel, keyScopeLabel, keyConnectionLabel } from "./portalAccessKeyLabels";
import PortalToolConnectionDialog from "./PortalToolConnectionDialog";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey };

/** A mounted tools page belongs to one project, including in-flight reads and secrets. */
export default function PortalAccessKeysPage() {
  const { accountIdForApi } = usePortalAccountContext();
  return <PortalAccessKeysContent key={String(accountIdForApi)} />;
}

function PortalAccessKeysContent() {
  const { locale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [state, setState] = useState<PortalAccessKeysState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<PortalAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccessKeyAction | null>(null);
  const [createOptions, setCreateOptions] = useState<PortalToolAccessCreateOptions | null>(null);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionSelection, setConnectionSelection] = useState({ keyId: "", spaceId: "" });
  const [queryCreateHandled, setQueryCreateHandled] = useState(false);

  const requestedSpaceId = searchParams.get("space_id") ?? "";
  const requestedCreateTarget = searchParams.get("create") ?? "";

  const loadKeys = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setState(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortalAccessKeysState(accountIdForApi);
      setState(data);
    } catch (err) {
      setState(null);
      setError(extractApiError(err, t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden.", zh: "无法加载工具访问凭据。" })));
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [loadKeys]);

  const visibleKeys = useMemo(() => {
    const keys = (state?.access_keys ?? []).filter((key) => !key.is_portal);
    if (createdKey && !createdKey.is_portal && !keys.some((key) => key.access_key_id === createdKey.access_key_id)) {
      return [createdKey, ...keys];
    }
    return keys;
  }, [createdKey, state?.access_keys]);
  const activeKeys = useMemo(() => visibleKeys.filter((key) => key.is_active), [visibleKeys]);
  const personalKeys = useMemo(
    () => visibleKeys.filter((key) => key.target_type !== "external"),
    [visibleKeys]
  );
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const canCreateExternalAccess = Boolean(state?.can_create_external_access);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const personalAccessLimitReached = maxAccessKeys > 0 && personalKeys.length >= maxAccessKeys;
  const canCreatePersonalAccess = canManageAccessKeys && !personalAccessLimitReached;
  const canCreateAnyAccess = canCreatePersonalAccess || canCreateExternalAccess;
  const canManageKey = (key: PortalAccessKey) =>
    key.target_type === "external" || canManageAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });
  useEffect(() => {
    if (
      queryCreateHandled ||
      requestedCreateTarget !== "external" ||
      !state ||
      !canCreateExternalAccess ||
      !requestedSpaceId
    ) {
      return;
    }
    setCreateOptions({ target: "external", spaceId: requestedSpaceId });
    setQueryCreateHandled(true);
  }, [canCreateExternalAccess, queryCreateHandled, requestedCreateTarget, requestedSpaceId, state]);

  const openCreateWorkflow = () => {
    if (createDisabled) return;
    setError(null);
    setCreateOptions({ target: canCreatePersonalAccess ? "self" : "external" });
  };

  const handleCreateKey = async (payload: PortalAccessKeyCreate, selectedSpace: PortalStorageSpaceSummary | null) => {
    if (!accountIdForApi || busy) return;
    if (payload.target_type === "self" && !canCreatePersonalAccess) return;
    if (payload.target_type === "external" && !canCreateExternalAccess) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createPortalAccessKey(accountIdForApi, payload);
      setCreatedKey(key);
      const createdBucket = bucketNameForPortalExternalTool(key, selectedSpace);
      setConnectionSelection({ keyId: key.access_key_id, spaceId: createdBucket || "" });
      setActionMessage(
        key.secret_access_key ? null : key.target_type === "external"
          ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt", zh: "已创建外部工具访问凭据" })
          : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt", zh: "已创建个人工具访问凭据" })
      );
      setCreateOptions(null);
      await loadKeys();
    } catch (err) {
      setError(extractApiError(err, t({ en: "Unable to create tool access.", fr: "Impossible de créer l'accès outil.", de: "Werkzeugzugriff kann nicht erstellt werden.", zh: "无法创建工具访问凭据。" })));
    } finally {
      setBusy(null);
    }
  };

  const updateKeyStatus = async (key: PortalAccessKey, active: boolean) => {
    if (!accountIdForApi || !canManageKey(key) || key.is_portal) return;
    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, active);
      setActionMessage(active ? t({ en: "Tool access enabled", fr: "Accès outil activé", de: "Werkzeugzugriff aktiviert", zh: "已启用工具访问" }) : t({ en: "Tool access disabled", fr: "Accès outil désactivé", de: "Werkzeugzugriff deaktiviert", zh: "已禁用工具访问" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      setError(extractApiError(err, t({ en: "Unable to update tool access.", fr: "Impossible de mettre à jour l'accès outil.", de: "Werkzeugzugriff kann nicht aktualisiert werden.", zh: "无法更新工具访问凭据。" })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageKey(key) || key.is_portal) return;
    const active = key.is_active;
    if (active) {
      setPendingAction({ type: "disable", key });
      return;
    }
    void updateKeyStatus(key, true);
  };

  const handleDeleteKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageKey(key) || key.is_portal) return;
    setPendingAction({ type: "delete", key });
  };

  const confirmDeleteKey = async (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageKey(key) || key.is_portal) return;
    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      setActionMessage(t({ en: "Tool access deleted", fr: "Accès outil supprimé", de: "Werkzeugzugriff gelöscht", zh: "已删除工具访问凭据" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      setError(extractApiError(err, t({ en: "Unable to delete tool access.", fr: "Impossible de supprimer l'accès outil.", de: "Werkzeugzugriff kann nicht gelöscht werden.", zh: "无法删除工具访问凭据。" })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const closeConnectionDialog = () => setConnectionDialogOpen(false);
  const openConnectionDialog = (key?: PortalAccessKey) => {
    if (key) setConnectionSelection(current => ({ ...current, keyId: key.access_key_id }));
    setConnectionDialogOpen(true);
  };

  const configureDisabled = accountLoading || loading || !hasAccountContext || !accountIdForApi || !state || Boolean(busy);
  const createDisabled = !state || !canCreateAnyAccess || Boolean(busy);
  const accessKeyColumns: DataTableColumn<PortalAccessKey>[] = [
    {
      id: "access-key",
      label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }),
      primary: true,
      cellClassName: "max-w-[18rem] break-all font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: t({ en: "Status", fr: "Statut", de: "Status", zh: "状态" }),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => portalAccessKeyStatusLabel(key.is_active, t),
    },
    {
      id: "target",
      label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" }),
      cellClassName: "min-w-[10rem]",
      render: (key) => keyTargetLabel(key, t),
    },
    {
      id: "scope",
      label: t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" }),
      cellClassName: "min-w-[12rem]",
      render: (key) => keyScopeLabel(key, t),
    },
    {
      id: "created",
      label: t({ en: "Created on", fr: "Créée le", de: "Erstellt am", zh: "创建时间" }),
      render: (key) => portalDateTimeLabel(key.created_at, locale),
    },
    {
      id: "actions",
      label: t({ en: "Actions", fr: "Actions", de: "Aktionen", zh: "操作" }),
      align: "right",
      mobileRole: "actions",
      render: (key) => {
        const active = key.is_active;
        const disabled = Boolean(busy) || !canManageKey(key);
        return (
          <ListActions>
            {active ? (
              <ListActionButton
                type="button"
                onClick={() => openConnectionDialog(key)}
                disabled={Boolean(busy)}
                aria-label={`${t({ en: "Connect", fr: "Connecter", de: "Verbinden", zh: "连接" })} ${keyConnectionLabel(key, locale, t)}`}
                {...dataTableDefaultActionProps}
              >
                {t({ en: "Connect", fr: "Connecter", de: "Verbinden", zh: "连接" })}
              </ListActionButton>
            ) : null}
            <ListActionButton
              type="button"
              onClick={() => handleToggleKey(key)}
              disabled={disabled}
            >
              {busy === `toggle:${key.access_key_id}`
                ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert...", zh: "正在保存…" })
                : active
                  ? t({ en: "Disable", fr: "Désactiver", de: "Deaktivieren", zh: "禁用" })
                  : t({ en: "Enable", fr: "Activer", de: "Aktivieren", zh: "启用" })}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteKey(key)}
               variant="danger"
              disabled={disabled}
            >
              {busy === `delete:${key.access_key_id}` ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht...", zh: "正在删除…" }) : t({ en: "Delete", fr: "Supprimer", de: "Löschen", zh: "删除" })}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(Boolean(createOptions))}>
      <PageHeader actionPresentation="listing"
        title={t({ en: "External S3 tools", fr: "Outils S3 externes", de: "Externe S3-Werkzeuge", zh: "外部 S3 工具" })}
        description={t({
          en: "Create S3 credentials for a desktop app, script, or external partner. Keep each access limited to the right space.",
          fr: "Créez des identifiants S3 pour une application de bureau, un script ou un partenaire externe. Limitez chaque accès au bon espace.",
          de: "Erstellen Sie S3-Zugangsdaten für Desktop-Apps, Skripte oder externe Partner. Begrenzen Sie jeden Zugriff auf den passenden Bereich.",
          zh: "为桌面应用、脚本或外部合作伙伴创建 S3 凭据。请将每项访问限制在合适的空间内。",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge", zh: "外部工具" }),
        })}
        actions={[
          {
            label: t({ en: "Configure a tool", fr: "Configurer un outil", de: "Werkzeug konfigurieren", zh: "配置工具" }),
            onClick: () => openConnectionDialog(),
            variant: "secondary",
            disabled: configureDisabled,
          },
          {
            label: busy === "create" ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt...", zh: "正在创建…" }) : t({ en: "New tool access", fr: "Nouvel accès outil", de: "Neuer Werkzeugzugriff", zh: "新建工具访问凭据" }),
            onClick: openCreateWorkflow,
            variant: "primary",
            disabled: createDisabled,
          },
        ]}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && !createOptions && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {state && !canManageAccessKeys && !canCreateExternalAccess && (
        <PageBanner tone="warning">{t({ en: "Creating new tool access is disabled for this project.", fr: "La création de nouveaux accès outil est désactivée pour ce projet.", de: "Das Erstellen neuer Werkzeugzugriffe ist für dieses Projekt deaktiviert.", zh: "此项目已禁用创建新的工具访问凭据。" })}</PageBanner>
      )}
      {createdKey?.secret_access_key && (
        <div className="space-y-3">
          <OneTimeSecretPanel
            title={
              <span role="status">{createdKey.target_type === "external"
                ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt", zh: "已创建外部工具访问凭据" })
                : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt", zh: "已创建个人工具访问凭据" })}</span>
            }
            description={
              <>{createdKey.target_type === "external"
                ? t({ en: "The secret is shown only once and is limited to the selected space.", fr: "Le secret n'est affiché qu'une seule fois et reste limité à l'espace sélectionné.", de: "Das Secret wird nur einmal angezeigt und bleibt auf den ausgewählten Bereich beschränkt.", zh: "密钥仅显示一次，访问范围限定为所选空间。" })
                : t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt.", zh: "密钥仅显示一次。" })}{" "}{t({
                  en: "Copy the secret key, then choose Configure a tool.",
                  fr: "Copiez la clé secrète, puis choisissez « Configurer un outil ».",
                  de: "Kopieren Sie den geheimen Schlüssel und wählen Sie dann „Werkzeug konfigurieren“.",
                  zh: "复制私有密钥，然后选择“配置工具”。",
                })}</>
            }
            badge={t({ en: "Copy these values now", fr: "Copiez ces valeurs maintenant", de: "Diese Werte jetzt kopieren", zh: "请立即复制这些值" })}
            copyFeedback={{
              copied: t({ en: "Copied to clipboard.", fr: "Copié dans le presse-papiers.", de: "In die Zwischenablage kopiert.", zh: "已复制到剪贴板。" }),
              failed: t({ en: "Unable to copy. Select and copy this value manually.", fr: "Copie impossible. Sélectionnez et copiez cette valeur manuellement.", de: "Kopieren nicht möglich. Wählen Sie diesen Wert aus und kopieren Sie ihn manuell.", zh: "无法复制。请选中此值并手动复制。" }),
            }}
            values={[
              {
                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }),
                value: createdKey.access_key_id,
                copyLabel: t({ en: "Copy Access ID", fr: "Copier l'ID d'accès", de: "Zugriffs-ID kopieren", zh: "复制访问密钥 ID" }),
              },
              {
                label: t({ en: "Secret key", fr: "Clé secrète", de: "Geheimer Schlüssel", zh: "私有密钥" }),
                value: createdKey.secret_access_key,
                copyLabel: t({ en: "Copy secret key", fr: "Copier la clé secrète", de: "Geheimen Schlüssel kopieren", zh: "复制私有密钥" }),
              },
            ]}
          />
        </div>
      )}

      {accountLoading ? (
        <PageBanner tone="info">{t({ en: "Loading project...", fr: "Chargement du projet...", de: "Projekt wird geladen...", zh: "正在加载项目…" })}</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a project before connecting external tools", fr: "Sélectionnez un projet avant de connecter des outils externes", de: "Wählen Sie ein Projekt aus, bevor Sie externe Werkzeuge verbinden", zh: "请先选择项目，再连接外部工具" })}
          description={t({ en: "External-tool access is scoped to the selected project.", fr: "L'accès aux outils externes est limité au projet sélectionné.", de: "Werkzeugzugriff ist auf das ausgewählte Projekt beschränkt.", zh: "外部工具的访问范围限定为所选项目。" })}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
          title={t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff", zh: "工具访问" })}
          secondaryContent={<p>{t({
            en: "Store secrets when they are created; they cannot be shown again. Portal's own runtime access is hidden from this list.",
            fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. L'accès runtime propre à Portal est masqué dans cette liste.",
            de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Portals eigener Laufzeitzugriff ist in dieser Liste ausgeblendet.",
            zh: "请在创建时保存私有密钥，之后无法再次查看。Portal 自身运行时使用的访问凭据不会显示在此列表中。",
          })}</p>}
          countLabel={t({ en: `${visibleKeys.length} access`, fr: `${visibleKeys.length} accès`, de: `${visibleKeys.length} Zugriffe`, zh: `${visibleKeys.length} 项访问凭据` })}
        >
          <DataTableShell
            columns={accessKeyColumns}
            rows={visibleKeys}
            rowKey={(key) => key.access_key_id}
            status={tableStatus}
            loadingMessage={t({ en: "Loading tool access...", fr: "Chargement des accès outil...", de: "Werkzeugzugriff wird geladen...", zh: "正在加载工具访问凭据…" })}
            errorMessage={t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden.", zh: "无法加载工具访问凭据。" })}
            emptyMessage={t({ en: "No external tool access yet.", fr: "Aucun accès outil externe pour l'instant.", de: "Noch kein externer Werkzeugzugriff.", zh: "尚无外部工具访问凭据。" })}
            rowClassName={(key) =>
              cx(
                "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                !key.is_active && "bg-slate-50/70 dark:bg-slate-900/40"
              )
            }
            responsiveCards
          />
        </ListPageSection>
      )}

      {connectionDialogOpen && state && hasAccountContext && <PortalToolConnectionDialog
        accountId={accountIdForApi} activeKeys={activeKeys} endpoint={state.s3_endpoint} forcePathStyle={state.force_path_style}
        selection={connectionSelection} onSelectionChange={setConnectionSelection} requestedSpaceId={requestedSpaceId}
        onClose={closeConnectionDialog} onCreate={canCreateAnyAccess ? openCreateWorkflow : undefined} />}

      {createOptions && <PortalToolAccessCreateWorkflow accountId={accountIdForApi} options={createOptions}
        personalAccessEnabled={canManageAccessKeys} externalAccessEnabled={canCreateExternalAccess}
        personalAccessLimitReached={personalAccessLimitReached} maxAccessKeys={maxAccessKeys}
        busy={busy === "create"} error={error} disabled={accountLoading}
        onCreate={handleCreateKey} onClose={() => setCreateOptions(null)} />}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable tool access", fr: "Désactiver l'accès outil", de: "Werkzeugzugriff deaktivieren", zh: "禁用工具访问" })}
          description={t({ en: "Confirm that you want to disable this tool access.", fr: "Confirmez que vous voulez désactiver cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff deaktivieren möchten.", zh: "确认要禁用此工具访问。" })}
          confirmLabel={t({ en: "Disable access", fr: "Désactiver l'accès", de: "Zugriff deaktivieren", zh: "禁用访问" })}
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse", zh: "服务地址" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst", zh: "已配置的存储服务" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop authenticating until it is re-enabled.", fr: "Les outils externes utilisant cet accès ne pourront plus s'authentifier jusqu'à sa réactivation.", de: "Externe Werkzeuge mit diesem Zugriff können sich nicht authentifizieren, bis er wieder aktiviert wird.", zh: "使用此凭据的外部工具将无法认证，直到重新启用。" }),
            t({ en: "The secret value cannot be displayed again from the Portal.", fr: "Le secret ne peut plus être affiché depuis le Portal.", de: "Das Secret kann im Portal nicht erneut angezeigt werden.", zh: "无法在 Portal 中再次查看私有密钥。" }),
            t({ en: "The active Portal runtime access is not affected.", fr: "L'accès runtime actif utilisé par Portal n'est pas affecté.", de: "Der aktive Portal-Laufzeitzugriff ist nicht betroffen.", zh: "Portal 当前运行时的访问不受影响。" }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete tool access", fr: "Supprimer l'accès outil", de: "Werkzeugzugriff löschen", zh: "删除工具访问凭据" })}
          description={t({ en: "Confirm that you want to permanently delete this tool access.", fr: "Confirmez que vous voulez supprimer définitivement cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff dauerhaft löschen möchten.", zh: "确认要永久删除此工具访问凭据。" })}
          confirmLabel={t({ en: "Delete access", fr: "Supprimer l'accès", de: "Zugriff löschen", zh: "删除访问凭据" })}
          loading={busy === `delete:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang", zh: "范围" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse", zh: "服务地址" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst", zh: "已配置的存储服务" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop working immediately.", fr: "Les outils externes utilisant cet accès cessent immédiatement de fonctionner.", de: "Externe Werkzeuge mit diesem Zugriff funktionieren sofort nicht mehr.", zh: "使用此凭据的外部工具将立即停止工作。" }),
            t({ en: "The secret value cannot be recovered or shown again.", fr: "Le secret ne peut pas être récupéré ni affiché à nouveau.", de: "Das Secret kann nicht wiederhergestellt oder erneut angezeigt werden.", zh: "私有密钥无法恢复或再次显示。" }),
            t({ en: "This deletion cannot be undone from the Portal.", fr: "Cette suppression ne peut pas être annulée depuis le Portal.", de: "Diese Löschung kann im Portal nicht rückgängig gemacht werden.", zh: "无法在 Portal 中撤销此删除操作。" }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key)}
        />
      ) : null}
    </div>
  );
}
