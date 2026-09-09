/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { S3AccountSelector } from "../../api/accountParams";
import { fetchPortalStorageSpaceSettings, updatePortalStorageSpaceSettings, type PortalStorageSpaceSettings as SpaceSettings } from "../../api/portal";
import StorageSpaceIcon from "../../components/StorageSpaceIcon";
import { SettingsItem, SettingsSection, SettingsSwitch } from "../../components/settings/SettingsLayout";
import { SettingsActions, SettingsButton, SettingsDialog, SettingsField, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { settingsLabels } from "../../components/settings/settingsLabels";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiBadge from "../../components/ui/UiBadge";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { portalStatusLabel } from "./portalI18n";
import { portalStorageSpaceStatusTone } from "./portalUi";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";
import StorageSpaceIdentityDialog from "./StorageSpaceIdentityDialog";
import StorageSpaceIconPickerModal from "./StorageSpaceIconPickerModal";
import { historyDraft, mergeSpaceHistory, type SpaceHistoryDraft } from "./storageSpaceSettingsForm";

const emptyHistory: SpaceHistoryDraft = { versioning_enabled: false, lifecycle_enabled: false, version_history_retention_days: "" };

export default function PortalStorageSpaceSettings({ accountId, space, canConfigureIcon, historyCleanupEnabled,
  onDirtyChange, onRefresh, managementActions }: {
  accountId: S3AccountSelector; space: PortalWorkspaceSpace; canConfigureIcon: boolean; historyCleanupEnabled: boolean;
  onDirtyChange: (dirty: boolean) => void; onRefresh: () => void;
  managementActions: (historyDirty: boolean) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const labels = settingsLabels(t);
  const { draft, setDraft, baseline, accept, cancel } = useSettingsDraft(emptyHistory);
  const dirty = baseline.versioning_enabled !== draft.versioning_enabled || baseline.lifecycle_enabled !== draft.lifecycle_enabled ||
    (draft.lifecycle_enabled && baseline.version_history_retention_days !== draft.version_history_retention_days);
  const [settings, setSettings] = useState<SpaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  const latestReview = useRef<SpaceSettings | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const hasFullAccess = space.role === "Owner" || space.role === "Manager";
  const archived = space.status === "Archived";
  const editable = hasFullAccess && !archived && Boolean(settings?.can_update);
  const loadError = t({ en: "Unable to load version history settings.", fr: "Impossible de charger les paramètres d’historique des versions.", de: "Einstellungen für den Versionsverlauf konnten nicht geladen werden." });
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!hasFullAccess) { setLoading(false); return; }
    setLoading(true);
    setLoadFailed(false);
    fetchPortalStorageSpaceSettings(accountId, space.id).then((value) => {
      if (cancelled) return;
      setSettings(value); accept(historyDraft(value));
    }).catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Identity/icon refreshes must not reset a history draft for this scope.
  }, [accountId, space.id, hasFullAccess, accept]);
  useEffect(() => {
    onDirtyChange(dirty || dialogDirty);
    return () => onDirtyChange(false);
  }, [dirty, dialogDirty, onDirtyChange]);
  const discard = () => {
    if (latestReview.current) { setSettings(latestReview.current); accept(historyDraft(latestReview.current)); latestReview.current = null; }
    else cancel();
    setError(null); setRetentionError(undefined); setSaved(false);
  };
  const guard = useSettingsCloseGuard({ hasUnsavedChanges: dirty, onClose: discard, disabled: busy,
    title: labels.discardTitle, description: labels.discardDescription, confirmLabel: labels.discard,
    cancelLabel: labels.keepEditing, closeLabel: labels.close });
  const titles = {
    versioning_enabled: t({ en: "Keep file versions", fr: "Conserver les versions des fichiers", de: "Dateiversionen aufbewahren" }),
    lifecycle_enabled: t({ en: "Automatic history cleanup", fr: "Nettoyage automatique de l’historique", de: "Versionsverlauf automatisch bereinigen" }),
    version_history_retention_days: t({ en: "Version history retention", fr: "Conservation de l’historique", de: "Aufbewahrung des Versionsverlaufs" }),
  };
  const save = async () => {
    if (!editable || pending.current || !dirty) return;
    const value = draft.version_history_retention_days;
    const invalid = draft.lifecycle_enabled && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1);
    setRetentionError(invalid ? t({ en: "Enter a positive whole number.", fr: "Saisissez un entier positif.", de: "Geben Sie eine positive ganze Zahl ein." }) : undefined);
    if (invalid) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    pending.current = true; setBusy(true); setSaved(false); setError(null);
    try {
      const latest = await fetchPortalStorageSpaceSettings(accountId, space.id);
      if (!active.current) return;
      latestReview.current = latest;
      if (!latest.can_update) {
        setSettings(latest);
        setError(t({ en: "Your editing access has changed. Your draft is preserved.", fr: "Vos droits de modification ont changé. Votre brouillon est conservé.", de: "Ihre Bearbeitungsrechte haben sich geändert. Ihr Entwurf bleibt erhalten." }));
        return;
      }
      const { payload, conflicts } = mergeSpaceHistory(baseline, draft, latest);
      if (conflicts.length) {
        setError(`${t({ en: "These settings changed on the server. Cancel to load the current values:", fr: "Ces paramètres ont changé sur le serveur. Annulez pour charger les valeurs actuelles :", de: "Diese Einstellungen wurden auf dem Server geändert. Brechen Sie ab, um die aktuellen Werte zu laden:" })} ${new Intl.ListFormat(locale).format(conflicts.map((key) => titles[key]))}`);
        return;
      }
      const next = await updatePortalStorageSpaceSettings(accountId, space.id, payload);
      if (!active.current) return;
      setSettings(next); accept(historyDraft(next)); latestReview.current = null; setSaved(true);
    } catch (cause) {
      if (active.current) setError(extractApiError(cause, t({ en: "Unable to update version history settings. Your draft is preserved.", fr: "Impossible de modifier l’historique. Votre brouillon est conservé.", de: "Der Versionsverlauf konnte nicht aktualisiert werden. Ihr Entwurf bleibt erhalten." })));
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const update = <K extends keyof SpaceHistoryDraft>(key: K, value: SpaceHistoryDraft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setSaved(false); };
  const enabled = (value: boolean) => value ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert" }) : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert" });
  const formatDays = (days: number) => new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long" }).format(days);
  const readOnlyReason = archived
    ? t({ en: "Archived spaces keep their history settings. Restore the space to change them.", fr: "Les espaces archivés conservent leur historique. Restaurez l’espace pour modifier ces paramètres.", de: "Archivierte Bereiche behalten ihre Verlaufseinstellungen. Stellen Sie den Bereich wieder her, um sie zu ändern." })
    : t({ en: "Only a project Portal Manager can change these settings. Owners can review them.", fr: "Seul un gestionnaire Portal du projet peut modifier ces paramètres. Les propriétaires peuvent les consulter.", de: "Nur ein Portal Manager des Projekts kann diese Einstellungen ändern. Eigentümer können sie einsehen." });
  const refresh = () => { setSaved(false); onRefresh(); };
  return <div className="settings-compact">
    {hasFullAccess && <>
      <SettingsSection presentation="compact" title={t({ en: "Identity", fr: "Identité", de: "Identität" })}>
        <SettingsItem compact title={space.name} description={space.description || t({ en: "No description", fr: "Aucune description", de: "Keine Beschreibung" })}
          action={<SettingsButton variant="secondary" onClick={() => setIdentityOpen(true)}>{t({ en: "Edit details", fr: "Modifier", de: "Details bearbeiten" })}</SettingsButton>} />
        <SettingsItem compact title={t({ en: "Space icon", fr: "Icône de l’espace", de: "Bereichssymbol" })}
          icon={<StorageSpaceIcon icon={space.icon} name={space.name} size="sm" decorative />}
          action={canConfigureIcon ? <SettingsButton variant="secondary" onClick={() => setIconOpen(true)}>{t({ en: "Change icon", fr: "Modifier l’icône", de: "Symbol ändern" })}</SettingsButton> : <span className="settings-readonly">{t({ en: "Managed by a Portal Manager", fr: "Gérée par un gestionnaire Portal", de: "Von einem Portal Manager verwaltet" })}</span>} />
      </SettingsSection>
      <form ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <SettingsSection presentation="compact" title={t({ en: "File history", fr: "Historique des fichiers", de: "Dateiverlauf" })}>
          {loading && <p role="status">{t({ en: "Loading history settings...", fr: "Chargement de l’historique…", de: "Verlaufseinstellungen werden geladen…" })}</p>}
          {settings && <>
            {!editable && <p className="py-2 text-[13px] text-[var(--ui-text-muted)]">{readOnlyReason}</p>}
            <SettingsItem compact title={titles.versioning_enabled}
              status={editable && settings.versioning_status === "Suspended" ? <UiBadge tone="neutral">{t({ en: "Suspended", fr: "Suspendu", de: "Ausgesetzt" })}</UiBadge> : undefined}
              description={t({ en: "Keep previous versions when files are replaced. Turning this off keeps existing versions.", fr: "Conservez les versions précédentes lorsqu’un fichier est remplacé. La désactivation conserve les versions existantes.", de: "Bewahren Sie frühere Versionen ersetzter Dateien auf. Beim Deaktivieren bleiben vorhandene Versionen erhalten." })}
              action={editable ? <SettingsSwitch ariaLabel={titles.versioning_enabled} checked={draft.versioning_enabled} disabled={busy} onChange={(value) => update("versioning_enabled", value)} />
                : <span className="settings-readonly">{settings.versioning_status === "Suspended" ? t({ en: "Suspended", fr: "Suspendu", de: "Ausgesetzt" }) : enabled(settings.versioning_enabled)}</span>} />
            <SettingsItem compact title={titles.lifecycle_enabled}
              description={t({ en: "Remove older versions after the retention period and clear leftover deletion records. Other storage rules are preserved.", fr: "Supprimez les anciennes versions après le délai de conservation et les traces de suppression restantes. Les autres règles du stockage sont conservées.", de: "Entfernen Sie ältere Versionen nach der Aufbewahrungsfrist und verbliebene Löschvermerke. Andere Speicherregeln bleiben erhalten." })}
              action={editable ? <SettingsSwitch ariaLabel={titles.lifecycle_enabled} checked={draft.lifecycle_enabled} disabled={busy} onChange={(value) => update("lifecycle_enabled", value)} /> : <span className="settings-readonly">{enabled(settings.lifecycle_enabled)}</span>} />
            <SettingsItem compact title={titles.version_history_retention_days}
              description={!draft.lifecycle_enabled ? t({ en: "Applies only while automatic cleanup is enabled.", fr: "S’applique uniquement lorsque le nettoyage automatique est activé.", de: "Gilt nur bei aktivierter automatischer Bereinigung." }) : undefined}
              action={editable && draft.lifecycle_enabled ? <SettingsField label={titles.version_history_retention_days} type="number" min={1} step={1} className="w-24"
                value={draft.version_history_retention_days} error={retentionError} disabled={busy}
                help={t({ en: "Days", fr: "Jours", de: "Tage" })} onChange={(event) => update("version_history_retention_days", event.target.value)} />
                : <span className="settings-readonly">{formatDays(settings.version_history_retention_days)}</span>} />
          </>}
          {(error || loadFailed) && <UiInlineMessage tone="error" role="alert">{error || loadError}</UiInlineMessage>}
          {saved && <UiInlineMessage tone="success" role="status">{t({ en: "Version history settings saved.", fr: "Paramètres d’historique enregistrés.", de: "Verlaufseinstellungen gespeichert." })}</UiInlineMessage>}
        </SettingsSection>
        <SettingsActions dirty={dirty} busy={busy} disabled={!editable} onSave={() => void save()} onCancel={guard.requestClose}
          saveLabel={t({ en: "Save history settings", fr: "Enregistrer l’historique", de: "Verlaufseinstellungen speichern" })} cancelLabel={labels.cancel} savingLabel={t({ en: "Saving...", fr: "Enregistrement…", de: "Speichern…" })} />
      </form>
    </>}
    <SettingsSection presentation="compact" title={t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" })}>
      <SettingsItem compact title={t({ en: "Connect an application", fr: "Connecter une application", de: "Anwendung verbinden" })}
        description={archived ? t({ en: "Unavailable while archived", fr: "Indisponible si archivé", de: "Archiviert nicht verfügbar" }) : t({ en: "View the storage name and configure access for an external tool.", fr: "Consultez le nom du stockage et configurez l’accès d’un outil externe.", de: "Zeigen Sie den Speichernamen an und konfigurieren Sie den Zugriff für ein externes Werkzeug." })}
        action={<SettingsButton variant="secondary" disabled={archived} onClick={() => setDetailsOpen(true)}>{t({ en: "Connection details", fr: "Détails de connexion", de: "Verbindungsdetails" })}</SettingsButton>} />
    </SettingsSection>
    {hasFullAccess && <SettingsSection presentation="compact" title={t({ en: "Space management", fr: "Gestion de l’espace", de: "Bereich verwalten" })}>
      <SettingsItem compact title={t({ en: "Status", fr: "Statut", de: "Status" })}
        description={`${t({ en: "Created", fr: "Créé", de: "Erstellt" })} ${space.createdLabel}`}
        status={<UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(space.status, t)}</UiBadge>}
        action={managementActions(dirty || busy)} />
      {dirty && <p className="py-2 text-[13px] text-[var(--ui-text-muted)]">{t({ en: "Save or cancel the history changes before running an operation on this space.", fr: "Enregistrez ou annulez les modifications de l’historique avant de lancer une opération sur cet espace.", de: "Speichern oder verwerfen Sie die Verlaufsänderungen, bevor Sie eine Aktion für diesen Bereich ausführen." })}</p>}
      <p className="py-2 text-[13px] text-[var(--ui-text-muted)]">{!historyCleanupEnabled
        ? t({ en: "Manual history cleanup is disabled for this project.", fr: "Le nettoyage manuel de l’historique est désactivé pour ce projet.", de: "Die manuelle Verlaufsbereinigung ist für dieses Projekt deaktiviert." })
        : t({ en: "Manual cleanup keeps current files and removes older versions and leftover deletion records.", fr: "Le nettoyage manuel conserve les fichiers courants et retire les anciennes versions et les traces de suppression restantes.", de: "Die manuelle Bereinigung behält aktuelle Dateien und entfernt ältere Versionen und verbliebene Löschvermerke." })}</p>
    </SettingsSection>}
    {guard.confirmationDialog}
    {identityOpen && <StorageSpaceIdentityDialog accountId={accountId} space={space} onClose={() => setIdentityOpen(false)} onSaved={refresh} onDirtyChange={setDialogDirty} />}
    {iconOpen && canConfigureIcon && <StorageSpaceIconPickerModal accountId={accountId} space={space} onClose={() => setIconOpen(false)} onSaved={refresh} onDirtyChange={setDialogDirty} />}
    {detailsOpen && <SettingsDialog title={t({ en: "Connection details", fr: "Détails de connexion", de: "Verbindungsdetails" })} onClose={() => setDetailsOpen(false)} closeLabel={labels.close} closeAriaLabel={labels.close}>
      <p className="text-sm">{t({ en: "Use this name only when an external application asks for a storage or bucket name.", fr: "Utilisez ce nom uniquement lorsqu’une application externe demande un nom de stockage ou de bucket.", de: "Verwenden Sie diesen Namen nur, wenn eine externe Anwendung nach einem Speicher- oder Bucket-Namen fragt." })}</p>
      <p className="my-4 break-all font-mono text-sm">{space.internalName ?? space.id}</p>
      <Link className="settings-control inline-flex items-center rounded border border-[var(--ui-border)] px-3 text-sm text-primary" to={`/portal/access-keys?space_id=${encodeURIComponent(space.internalName ?? space.id)}&create=external`}>
        {t({ en: "Configure access", fr: "Configurer l’accès", de: "Zugriff konfigurieren" })}
      </Link>
    </SettingsDialog>}
  </div>;
}
