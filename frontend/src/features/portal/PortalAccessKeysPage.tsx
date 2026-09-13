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
      setError(extractApiError(err, t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden." })));
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
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const personalAccessLimitReached = maxAccessKeys > 0 && personalKeys.length >= maxAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });
  useEffect(() => {
    if (
      queryCreateHandled ||
      requestedCreateTarget !== "external" ||
      !state ||
      !canManageAccessKeys ||
      !requestedSpaceId
    ) {
      return;
    }
    setCreateOptions({ target: "external", spaceId: requestedSpaceId });
    setQueryCreateHandled(true);
  }, [canManageAccessKeys, queryCreateHandled, requestedCreateTarget, requestedSpaceId, state]);

  const openCreateWorkflow = () => {
    if (createDisabled) return;
    setError(null);
    setCreateOptions({ target: personalAccessLimitReached ? "external" : "self" });
  };

  const handleCreateKey = async (payload: PortalAccessKeyCreate, selectedSpace: PortalStorageSpaceSummary | null) => {
    if (!accountIdForApi || !canManageAccessKeys || busy) return;
    if (payload.target_type === "self" && personalAccessLimitReached) return;
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
          ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt" })
          : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt" })
      );
      setCreateOptions(null);
      await loadKeys();
    } catch (err) {
      setError(extractApiError(err, t({ en: "Unable to create tool access.", fr: "Impossible de créer l'accès outil.", de: "Werkzeugzugriff kann nicht erstellt werden." })));
    } finally {
      setBusy(null);
    }
  };

  const updateKeyStatus = async (key: PortalAccessKey, active: boolean) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, active);
      setActionMessage(active ? t({ en: "Tool access enabled", fr: "Accès outil activé", de: "Werkzeugzugriff aktiviert" }) : t({ en: "Tool access disabled", fr: "Accès outil désactivé", de: "Werkzeugzugriff deaktiviert" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      setError(extractApiError(err, t({ en: "Unable to update tool access.", fr: "Impossible de mettre à jour l'accès outil.", de: "Werkzeugzugriff kann nicht aktualisiert werden." })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    const active = key.is_active;
    if (active) {
      setPendingAction({ type: "disable", key });
      return;
    }
    void updateKeyStatus(key, true);
  };

  const handleDeleteKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setPendingAction({ type: "delete", key });
  };

  const confirmDeleteKey = async (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      setActionMessage(t({ en: "Tool access deleted", fr: "Accès outil supprimé", de: "Werkzeugzugriff gelöscht" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      setError(extractApiError(err, t({ en: "Unable to delete tool access.", fr: "Impossible de supprimer l'accès outil.", de: "Werkzeugzugriff kann nicht gelöscht werden." })));
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
  const createDisabled = !state || !canManageAccessKeys || Boolean(busy);
  const accessKeyColumns: DataTableColumn<PortalAccessKey>[] = [
    {
      id: "access-key",
      label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
      primary: true,
      cellClassName: "max-w-[18rem] break-all font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: t({ en: "Status", fr: "Statut", de: "Status" }),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => portalAccessKeyStatusLabel(key.is_active, t),
    },
    {
      id: "target",
      label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }),
      cellClassName: "min-w-[10rem]",
      render: (key) => keyTargetLabel(key, t),
    },
    {
      id: "scope",
      label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }),
      cellClassName: "min-w-[12rem]",
      render: (key) => keyScopeLabel(key, t),
    },
    {
      id: "created",
      label: t({ en: "Created on", fr: "Créée le", de: "Erstellt am" }),
      render: (key) => portalDateTimeLabel(key.created_at, locale),
    },
    {
      id: "actions",
      label: t({ en: "Actions", fr: "Actions", de: "Aktionen" }),
      align: "right",
      mobileRole: "actions",
      render: (key) => {
        const active = key.is_active;
        const disabled = Boolean(busy) || !canManageAccessKeys;
        return (
          <ListActions>
            {active ? (
              <ListActionButton
                type="button"
                onClick={() => openConnectionDialog(key)}
                disabled={Boolean(busy)}
                aria-label={`${t({ en: "Connect", fr: "Connecter", de: "Verbinden" })} ${keyConnectionLabel(key, locale, t)}`}
                {...dataTableDefaultActionProps}
              >
                {t({ en: "Connect", fr: "Connecter", de: "Verbinden" })}
              </ListActionButton>
            ) : null}
            <ListActionButton
              type="button"
              onClick={() => handleToggleKey(key)}
              disabled={disabled}
            >
              {busy === `toggle:${key.access_key_id}`
                ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." })
                : active
                  ? t({ en: "Disable", fr: "Désactiver", de: "Deaktivieren" })
                  : t({ en: "Enable", fr: "Activer", de: "Aktivieren" })}
            </ListActionButton>
            <ListActionButton
              type="button"
              onClick={() => handleDeleteKey(key)}
               variant="danger"
              disabled={disabled}
            >
              {busy === `delete:${key.access_key_id}` ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht..." }) : t({ en: "Delete", fr: "Supprimer", de: "Löschen" })}
            </ListActionButton>
          </ListActions>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(Boolean(createOptions))}>
      <PageHeader actionPresentation="listing"
        title={t({ en: "External S3 tools", fr: "Outils S3 externes", de: "Externe S3-Werkzeuge" })}
        description={t({
          en: "Create S3 credentials for a desktop app, script, or external partner. Keep each access limited to the right space.",
          fr: "Créez des identifiants S3 pour une application de bureau, un script ou un partenaire externe. Limitez chaque accès au bon espace.",
          de: "Erstellen Sie S3-Zugangsdaten für Desktop-Apps, Skripte oder externe Partner. Begrenzen Sie jeden Zugriff auf den passenden Bereich.",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" }),
        })}
        actions={[
          {
            label: t({ en: "Configure a tool", fr: "Configurer un outil", de: "Werkzeug konfigurieren" }),
            onClick: () => openConnectionDialog(),
            variant: "secondary",
            disabled: configureDisabled,
          },
          {
            label: busy === "create" ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "New tool access", fr: "Nouvel accès outil", de: "Neuer Werkzeugzugriff" }),
            onClick: openCreateWorkflow,
            variant: "primary",
            disabled: createDisabled,
          },
        ]}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && !createOptions && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {state && !canManageAccessKeys && (
        <PageBanner tone="warning">{t({ en: "External-tool access is disabled for this project.", fr: "L'accès aux outils externes est désactivé pour ce projet.", de: "Der Zugriff für externe Werkzeuge ist für dieses Projekt deaktiviert." })}</PageBanner>
      )}
      {createdKey?.secret_access_key && (
        <div className="space-y-3">
          <OneTimeSecretPanel
            title={
              <span role="status">{createdKey.target_type === "external"
                ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt" })
                : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt" })}</span>
            }
            description={
              <>{createdKey.target_type === "external"
                ? t({ en: "The secret is shown only once and is limited to the selected space.", fr: "Le secret n'est affiché qu'une seule fois et reste limité à l'espace sélectionné.", de: "Das Secret wird nur einmal angezeigt und bleibt auf den ausgewählten Bereich beschränkt." })
                : t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt." })}{" "}{t({
                  en: "Copy the secret key, then choose Configure a tool.",
                  fr: "Copiez la clé secrète, puis choisissez « Configurer un outil ».",
                  de: "Kopieren Sie den geheimen Schlüssel und wählen Sie dann „Werkzeug konfigurieren“.",
                })}</>
            }
            badge={t({ en: "Copy these values now", fr: "Copiez ces valeurs maintenant", de: "Diese Werte jetzt kopieren" })}
            copyFeedback={{
              copied: t({ en: "Copied to clipboard.", fr: "Copié dans le presse-papiers.", de: "In die Zwischenablage kopiert." }),
              failed: t({ en: "Unable to copy. Select and copy this value manually.", fr: "Copie impossible. Sélectionnez et copiez cette valeur manuellement.", de: "Kopieren nicht möglich. Wählen Sie diesen Wert aus und kopieren Sie ihn manuell." }),
            }}
            values={[
              {
                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
                value: createdKey.access_key_id,
                copyLabel: t({ en: "Copy Access ID", fr: "Copier l'ID d'accès", de: "Zugriffs-ID kopieren" }),
              },
              {
                label: t({ en: "Secret key", fr: "Clé secrète", de: "Geheimer Schlüssel" }),
                value: createdKey.secret_access_key,
                copyLabel: t({ en: "Copy secret key", fr: "Copier la clé secrète", de: "Geheimen Schlüssel kopieren" }),
              },
            ]}
          />
        </div>
      )}

      {accountLoading ? (
        <PageBanner tone="info">{t({ en: "Loading project...", fr: "Chargement du projet...", de: "Projekt wird geladen..." })}</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a project before connecting external tools", fr: "Sélectionnez un projet avant de connecter des outils externes", de: "Wählen Sie ein Projekt aus, bevor Sie externe Werkzeuge verbinden" })}
          description={t({ en: "External-tool access is scoped to the selected project.", fr: "L'accès aux outils externes est limité au projet sélectionné.", de: "Werkzeugzugriff ist auf das ausgewählte Projekt beschränkt." })}
          tone="warning"
        />
      ) : (
        <ListPageSection variant="page"
          title={t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff" })}
          secondaryContent={<p>{t({
            en: "Store secrets when they are created; they cannot be shown again. Portal's own runtime access is hidden from this list.",
            fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. L'accès runtime propre à Portal est masqué dans cette liste.",
            de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Portals eigener Laufzeitzugriff ist in dieser Liste ausgeblendet.",
          })}</p>}
          countLabel={t({ en: `${visibleKeys.length} access`, fr: `${visibleKeys.length} accès`, de: `${visibleKeys.length} Zugriffe` })}
        >
          <DataTableShell
            columns={accessKeyColumns}
            rows={visibleKeys}
            rowKey={(key) => key.access_key_id}
            status={tableStatus}
            loadingMessage={t({ en: "Loading tool access...", fr: "Chargement des accès outil...", de: "Werkzeugzugriff wird geladen..." })}
            errorMessage={t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden." })}
            emptyMessage={t({ en: "No external tool access yet.", fr: "Aucun accès outil externe pour l'instant.", de: "Noch kein externer Werkzeugzugriff." })}
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
        onClose={closeConnectionDialog} onCreate={canManageAccessKeys ? openCreateWorkflow : undefined} />}

      {createOptions && <PortalToolAccessCreateWorkflow accountId={accountIdForApi} options={createOptions}
        personalAccessLimitReached={personalAccessLimitReached} maxAccessKeys={maxAccessKeys}
        busy={busy === "create"} error={error} disabled={!canManageAccessKeys || accountLoading}
        onCreate={handleCreateKey} onClose={() => setCreateOptions(null)} />}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable tool access", fr: "Désactiver l'accès outil", de: "Werkzeugzugriff deaktivieren" })}
          description={t({ en: "Confirm that you want to disable this tool access.", fr: "Confirmez que vous voulez désactiver cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff deaktivieren möchten." })}
          confirmLabel={t({ en: "Disable access", fr: "Désactiver l'accès", de: "Zugriff deaktivieren" })}
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop authenticating until it is re-enabled.", fr: "Les outils externes utilisant cet accès ne pourront plus s'authentifier jusqu'à sa réactivation.", de: "Externe Werkzeuge mit diesem Zugriff können sich nicht authentifizieren, bis er wieder aktiviert wird." }),
            t({ en: "The secret value cannot be displayed again from the Portal.", fr: "Le secret ne peut plus être affiché depuis le Portal.", de: "Das Secret kann im Portal nicht erneut angezeigt werden." }),
            t({ en: "The active Portal runtime access is not affected.", fr: "L'accès runtime actif utilisé par Portal n'est pas affecté.", de: "Der aktive Portal-Laufzeitzugriff ist nicht betroffen." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete tool access", fr: "Supprimer l'accès outil", de: "Werkzeugzugriff löschen" })}
          description={t({ en: "Confirm that you want to permanently delete this tool access.", fr: "Confirmez que vous voulez supprimer définitivement cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff dauerhaft löschen möchten." })}
          confirmLabel={t({ en: "Delete access", fr: "Supprimer l'accès", de: "Zugriff löschen" })}
          loading={busy === `delete:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop working immediately.", fr: "Les outils externes utilisant cet accès cessent immédiatement de fonctionner.", de: "Externe Werkzeuge mit diesem Zugriff funktionieren sofort nicht mehr." }),
            t({ en: "The secret value cannot be recovered or shown again.", fr: "Le secret ne peut pas être récupéré ni affiché à nouveau.", de: "Das Secret kann nicht wiederhergestellt oder erneut angezeigt werden." }),
            t({ en: "This deletion cannot be undone from the Portal.", fr: "Cette suppression ne peut pas être annulée depuis le Portal.", de: "Diese Löschung kann im Portal nicht rückgängig gemacht werden." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key)}
        />
      ) : null}
    </div>
  );
}
