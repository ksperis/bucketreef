/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useMemo, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { listPortalStorageSpaces, type PortalStorageSpaceSummary } from "../../api/portal";
import type { PortalAccessKey } from "../../api/portalAccessKeys";
import { SettingsDialog, SettingsButton as UiButton } from "../../components/settings/SettingsControls";
import PageEmptyState from "../../components/PageEmptyState";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiLabelClass, uiMutedTextClass, uiPanelMutedClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { keyConnectionLabel } from "./portalAccessKeyLabels";
import {
  buildCyberduckBookmark, buildGenericConnectionSheet, buildRcloneConfig, buildWinScpProfile,
  bucketNameForPortalExternalTool, parsePortalExternalToolEndpoint, portalExternalToolBaseFilename,
  portalExternalToolPermissionLabel, portalExternalToolRcloneRemoteName, portalExternalToolRcloneSecretEnvironmentVariable,
  storageSpaceNameForPortalExternalTool, triggerPortalExternalToolDownload, type PortalExternalToolConnection,
} from "./portalExternalToolAccess";

type PortalToolConnectionSelection = { keyId: string; spaceId: string };

export default function PortalToolConnectionDialog({ accountId, activeKeys, endpoint, forcePathStyle, selection,
  requestedSpaceId, onSelectionChange, onClose, onCreate,
}: {
  accountId: S3AccountSelector; activeKeys: PortalAccessKey[]; endpoint?: string | null; forcePathStyle?: boolean;
  selection: PortalToolConnectionSelection; requestedSpaceId: string;
  onSelectionChange: (selection: PortalToolConnectionSelection) => void;
  onClose: () => void; onCreate?: () => void;
}) {
  const { locale, t } = useI18n();
  const [connectionSpaces, setConnectionSpaces] = useState<PortalStorageSpaceSummary[]>([]);
  const [connectionSpacesLoading, setConnectionSpacesLoading] = useState(true);
  const [connectionSpacesError, setConnectionSpacesError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setConnectionSpacesLoading(true); setConnectionSpacesError(null);
    void listPortalStorageSpaces(accountId, { sort: "name" }).then(spaces => {
      if (active) setConnectionSpaces(spaces.filter(space => !space.archived_at));
    }).catch(cause => {
      if (active) { setConnectionSpaces([]); setConnectionSpacesError(extractApiError(cause, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden." }))); }
    }).finally(() => { if (active) setConnectionSpacesLoading(false); });
    return () => { active = false; };
  }, [accountId, revision, t]);
  useEffect(() => setMessage(null), [selection]);
  const selectedConnectionKey = useMemo(
    () => activeKeys.find((key) => key.access_key_id === selection.keyId) ?? activeKeys[0] ?? null,
    [activeKeys, selection.keyId]
  );
  const selectedConnectionKeyBucket = selectedConnectionKey?.target_type === "external"
    ? bucketNameForPortalExternalTool(selectedConnectionKey, null)
    : "";
  const selectedConnectionSpace = useMemo(() => {
    const matchValue = selectedConnectionKeyBucket || selection.spaceId || requestedSpaceId;
    return (
      connectionSpaces.find((space) => space.id === matchValue || space.internal_bucket_name === matchValue) ??
      (selectedConnectionKeyBucket ? null : connectionSpaces[0]) ??
      null
    );
  }, [selection.spaceId, connectionSpaces, selectedConnectionKeyBucket, requestedSpaceId]);
  const selectedConnectionBucketName = bucketNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace);
  const selectedConnection: PortalExternalToolConnection | null = selectedConnectionKey && selectedConnectionBucketName
    ? {
        key: selectedConnectionKey,
        endpoint: parsePortalExternalToolEndpoint(endpoint),
        forcePathStyle: Boolean(forcePathStyle),
        storageSpaceName: storageSpaceNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace),
        bucketName: selectedConnectionBucketName,
        permissionLabel: portalExternalToolPermissionLabel(selectedConnectionKey.permission),
      }
    : null;
  const connectionEndpointLabel = selectedConnection?.endpoint?.original || endpoint || t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" });
  const setupFileUnavailable = Boolean(selectedConnection && !selectedConnection.endpoint);
  const selectedConnectionNeedsSpace = Boolean(selectedConnectionKey && !selectedConnectionKeyBucket);
  const selectedConnectionHasNoSpace =
    selectedConnectionNeedsSpace &&
    !connectionSpacesLoading &&
    !connectionSpacesError &&
    connectionSpaces.length === 0;
  const rcloneRemoteName = selectedConnection ? portalExternalToolRcloneRemoteName(selectedConnection) : "remote";
  const rcloneSecretEnvironmentVariable = selectedConnection
    ? portalExternalToolRcloneSecretEnvironmentVariable(selectedConnection)
    : "RCLONE_CONFIG_REMOTE_SECRET_ACCESS_KEY";

  const handleDownloadCyberduckBookmark = () => {
    if (!selectedConnection) return;
    if (!selectedConnection.endpoint) {
      setMessage(t({ en: "Cyberduck bookmark download needs a valid service address.", fr: "Le téléchargement du favori Cyberduck nécessite une adresse de service valide.", de: "Der Cyberduck-Bookmark benötigt eine gültige Serviceadresse." }));
      return;
    }
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.duck`;
    triggerPortalExternalToolDownload(filename, buildCyberduckBookmark(selectedConnection), "application/xml;charset=utf-8");
    setMessage(t({ en: "Cyberduck bookmark downloaded.", fr: "Favori Cyberduck téléchargé.", de: "Cyberduck-Bookmark heruntergeladen." }));
  };

  const handleDownloadWinScpProfile = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-winscp.ini`;
    triggerPortalExternalToolDownload(filename, buildWinScpProfile(selectedConnection), "text/plain;charset=utf-8");
    setMessage(t({ en: "WinSCP profile downloaded.", fr: "Profil WinSCP téléchargé.", de: "WinSCP-Profil heruntergeladen." }));
  };

  const handleDownloadRcloneConfig = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-rclone.conf`;
    triggerPortalExternalToolDownload(filename, buildRcloneConfig(selectedConnection), "text/plain;charset=utf-8");
    setMessage(t({ en: "rclone configuration downloaded.", fr: "Configuration rclone téléchargée.", de: "rclone-Konfiguration heruntergeladen." }));
  };

  const handleDownloadConnectionSheet = () => {
    if (!selectedConnection) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.txt`;
    triggerPortalExternalToolDownload(
      filename,
      buildGenericConnectionSheet(selectedConnection),
      "text/plain;charset=utf-8"
    );
    setMessage(t({ en: "Connection details downloaded.", fr: "Détails de connexion téléchargés.", de: "Verbindungsdetails heruntergeladen." }));
  };

  const handleCopyConnectionValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t({ en: "Value copied.", fr: "Valeur copiée.", de: "Wert kopiert." }));
    } catch {
      setMessage(t({ en: "Unable to copy this value.", fr: "Impossible de copier cette valeur.", de: "Dieser Wert kann nicht kopiert werden." }));
    }
  };

  return (
        <SettingsDialog
          title={t({ en: "Connect a tool", fr: "Connecter un outil", de: "Werkzeug verbinden" })}
          titleAs="h2"
          onClose={onClose}
          closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen" })}
          closeAriaLabel={t({ en: "Close modal", fr: "Fermer la fenêtre", de: "Dialog schließen" })}
        >
          <div className="settings-stack settings-fields">
            {message && <div className="sticky top-0 z-10 bg-[var(--ui-surface)]">
              <UiInlineMessage tone="info" role="status">{message}</UiInlineMessage>
            </div>}
            {activeKeys.length === 0 ? (
              <PageEmptyState
                eyebrow={t({ en: "Access required", fr: "Accès requis", de: "Zugriff erforderlich" })}
                title={t({ en: "Create an active tool access first", fr: "Créez d'abord un accès outil actif", de: "Erstellen Sie zuerst einen aktiven Werkzeugzugriff" })}
                description={t({
                  en: "The configuration identifies which permissions the application will use.",
                  fr: "La configuration doit indiquer quels droits l'application utilisera.",
                  de: "Die Konfiguration muss festlegen, welche Berechtigungen die Anwendung verwendet.",
                })}
                primaryAction={onCreate ? {
                  label: t({ en: "Create tool access", fr: "Créer un accès outil", de: "Werkzeugzugriff erstellen" }),
                  onClick: () => {
                    onClose();
                    onCreate?.();
                  },
                } : undefined}
              />
            ) : (
              <>
                <section className="settings-section-compact" aria-labelledby="portal-tool-connection-section">
                  <h3 id="portal-tool-connection-section" className="settings-section-title">
                    {t({ en: "Connection", fr: "Connexion", de: "Verbindung" })}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <UiSelect label={t({ en: "Access used", fr: "Accès utilisé", de: "Verwendeter Zugriff" })}
                        value={selectedConnectionKey?.access_key_id ?? ""}
                        onChange={(event) => onSelectionChange({ ...selection, keyId: event.target.value })}
                      >
                        {activeKeys.map((key) => (
                          <option key={key.access_key_id} value={key.access_key_id}>
                            {keyConnectionLabel(key, locale, t)}
                          </option>
                        ))}
                    </UiSelect>
                    {selectedConnectionKeyBucket ? (
                      <div className="space-y-1">
                        <span className={uiLabelClass}>{t({ en: "Space", fr: "Space", de: "Space" })}</span>
                        <p className={cx("min-h-10 rounded-lg border px-3 py-2 ui-body", uiPanelMutedClass, uiTitleTextClass)}>
                          {selectedConnectionKey?.storage_space_name || selectedConnection?.storageSpaceName || selectedConnectionKeyBucket}
                          {" — "}
                          {t({
                            en: "fixed when this access was created",
                            fr: "défini lors de la création de cet accès",
                            de: "bei der Erstellung dieses Zugriffs festgelegt",
                          })}
                        </p>
                      </div>
                    ) : (
                      <UiSelect label={t({ en: "Space", fr: "Space", de: "Space" })}
                          value={selectedConnectionSpace?.id ?? ""}
                          onChange={(event) => onSelectionChange({ ...selection, spaceId: event.target.value })}
                          disabled={connectionSpacesLoading || connectionSpaces.length === 0}
                        >
                          {connectionSpacesLoading ? (
                            <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</option>
                          ) : connectionSpaces.length === 0 ? (
                            <option value="">{t({ en: "No Space", fr: "Aucun Space", de: "Kein Space" })}</option>
                          ) : (
                            connectionSpaces.map((space) => (
                              <option key={space.id} value={space.id}>{space.name}</option>
                            ))
                          )}
                      </UiSelect>
                    )}
                  </div>
                </section>

                {selectedConnectionNeedsSpace && connectionSpacesError ? (
                  <UiInlineMessage tone="warning">{connectionSpacesError} {" "}<UiButton variant="secondary" onClick={() => setRevision(value => value + 1)}>{t({ en: "Retry", fr: "Réessayer", de: "Erneut versuchen" })}</UiButton></UiInlineMessage>
                ) : null}
                {selectedConnectionHasNoSpace ? (
                  <PageEmptyState
                    eyebrow={t({ en: "Space required", fr: "Space requis", de: "Space erforderlich" })}
                    title={t({ en: "Create a Space to continue", fr: "Créez un Space pour continuer", de: "Erstellen Sie einen Space, um fortzufahren" })}
                    description={t({
                      en: "The application needs a Space to use as its initial folder.",
                      fr: "L'application a besoin d'un Space comme dossier initial.",
                      de: "Die Anwendung benötigt einen Space als Startordner.",
                    })}
                    primaryAction={{
                      label: t({ en: "Create a Space", fr: "Créer un Space", de: "Space erstellen" }),
                      to: "/portal/storage-spaces?create=1",
                    }}
                  />
                ) : selectedConnection ? (
                  <>
                    <section className="settings-section-compact" aria-labelledby="portal-tool-application-section">
                      <div>
                        <h3 id="portal-tool-application-section" className="settings-section-title">
                          {t({ en: "Choose your application", fr: "Choisissez votre application", de: "Wählen Sie Ihre Anwendung" })}
                        </h3>
                        <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                          {t({
                            en: "Install the application first if you do not already have it, then import the downloaded file.",
                            fr: "Installez d'abord l'application si nécessaire, puis importez le fichier téléchargé.",
                            de: "Installieren Sie die Anwendung bei Bedarf zuerst und importieren Sie dann die heruntergeladene Datei.",
                          })}
                        </p>
                      </div>
                      <div className="settings-stack">
                        <article className="settings-stack min-w-0">
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>Cyberduck / Mountain Duck</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>
                              {t({ en: "macOS and Windows", fr: "macOS et Windows", de: "macOS und Windows" })}
                            </p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Browse files or mount the Space like a disk.",
                                fr: "Parcourez les fichiers ou montez le Space comme un disque.",
                                de: "Durchsuchen Sie Dateien oder binden Sie den Space wie ein Laufwerk ein.",
                              })}
                            </p>
                            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://cyberduck.io/download/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Cyberduck from the official site (opens in a new tab)", fr: "Installer Cyberduck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Cyberduck von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install Cyberduck", fr: "Installer Cyberduck", de: "Cyberduck installieren" })}
                              </a>
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://mountainduck.io/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Mountain Duck from the official site (opens in a new tab)", fr: "Installer Mountain Duck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Mountain Duck von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install Mountain Duck", fr: "Installer Mountain Duck", de: "Mountain Duck installieren" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="self-start"
                            variant="secondary"
                            onClick={handleDownloadCyberduckBookmark}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download Cyberduck or Mountain Duck configuration (.duck) for", fr: "Télécharger la configuration Cyberduck ou Mountain Duck (.duck) pour", de: "Cyberduck- oder Mountain-Duck-Konfiguration (.duck) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download configuration (.duck)", fr: "Télécharger la configuration (.duck)", de: "Konfiguration herunterladen (.duck)" })}
                          </UiButton>
                        </article>
                        <article className="settings-stack min-w-0 border-t border-[var(--ui-border-soft)] pt-3">
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>WinSCP</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>Windows</p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Transfer files with a graphical interface.",
                                fr: "Transférez des fichiers avec une interface graphique.",
                                de: "Übertragen Sie Dateien mit einer grafischen Oberfläche.",
                              })}
                            </p>
                            <p className="mt-3 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://winscp.net/eng/download.php"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install WinSCP from the official site (opens in a new tab)", fr: "Installer WinSCP depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "WinSCP von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install WinSCP", fr: "Installer WinSCP", de: "WinSCP installieren" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="self-start"
                            variant="secondary"
                            onClick={handleDownloadWinScpProfile}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download WinSCP profile (.ini) for", fr: "Télécharger le profil WinSCP (.ini) pour", de: "WinSCP-Profil (.ini) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download WinSCP profile (.ini)", fr: "Télécharger le profil WinSCP (.ini)", de: "WinSCP-Profil herunterladen (.ini)" })}
                          </UiButton>
                        </article>
                      </div>
                    </section>

                    {setupFileUnavailable ? (
                      <UiInlineMessage tone="warning">
                        {t({
                          en: "Configuration downloads are unavailable because the storage service address is invalid. Check the manual values or contact an administrator.",
                          fr: "Les téléchargements de configuration sont indisponibles car l'adresse du service de stockage est invalide. Vérifiez les valeurs manuelles ou contactez un administrateur.",
                          de: "Konfigurationsdownloads sind nicht verfügbar, weil die Adresse des Speicherdienstes ungültig ist. Prüfen Sie die manuellen Werte oder wenden Sie sich an einen Administrator.",
                        })}
                      </UiInlineMessage>
                    ) : null}

                    <details className="group border-t border-[var(--ui-border-soft)] pt-3">
                      <summary className={cx("cursor-pointer ui-body font-semibold", uiTitleTextClass)}>
                        {t({ en: "Advanced tools and manual setup", fr: "Outils avancés et configuration manuelle", de: "Erweiterte Werkzeuge und manuelle Einrichtung" })}
                      </summary>
                      <div className="settings-stack mt-3">
                        <section className="space-y-3" aria-labelledby="portal-rclone-setup">
                          <div>
                            <h4 id="portal-rclone-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>rclone</h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({ en: "Command line and automation.", fr: "Ligne de commande et automatisation.", de: "Kommandozeile und Automatisierung." })}
                              {" "}
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://rclone.org/downloads/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install rclone from the official site (opens in a new tab)", fr: "Installer rclone depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "rclone von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install rclone", fr: "Installer rclone", de: "rclone installieren" })}
                              </a>
                            </p>
                          </div>
                          <div className="grid gap-2 ui-caption">
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Secret environment variable", fr: "Variable d'environnement du secret", de: "Umgebungsvariable für das Secret" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>{rcloneSecretEnvironmentVariable}</code>
                            </div>
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Example command", fr: "Commande d'exemple", de: "Beispielbefehl" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>rclone lsd {rcloneRemoteName}:{selectedConnection.bucketName}</code>
                            </div>
                          </div>
                          <UiButton
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleDownloadRcloneConfig}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download rclone configuration (.conf) for", fr: "Télécharger la configuration rclone (.conf) pour", de: "rclone-Konfiguration (.conf) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download rclone configuration (.conf)", fr: "Télécharger la configuration rclone (.conf)", de: "rclone-Konfiguration herunterladen (.conf)" })}
                          </UiButton>
                        </section>

                        <section className="space-y-3 border-t border-[var(--ui-border-soft)] pt-3" aria-labelledby="portal-manual-s3-setup">
                          <div>
                            <h4 id="portal-manual-s3-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                              {t({ en: "Other S3-compatible application", fr: "Autre application compatible S3", de: "Andere S3-kompatible Anwendung" })}
                            </h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Enter the secret in the application when requested. It is never included in these downloads.",
                                fr: "Saisissez le secret dans l'application lorsqu'il est demandé. Il n'est jamais inclus dans ces téléchargements.",
                                de: "Geben Sie das Secret auf Nachfrage in der Anwendung ein. Es ist nie in diesen Downloads enthalten.",
                              })}
                            </p>
                          </div>
                          <dl className="grid gap-3 ui-caption sm:grid-cols-2">
                            {[
                              {
                                label: t({ en: "S3 endpoint", fr: "Endpoint S3", de: "S3-Endpunkt" }),
                                value: connectionEndpointLabel,
                              },
                              {
                                label: t({ en: "Bucket", fr: "Bucket", de: "Bucket" }),
                                value: selectedConnection.bucketName,
                              },
                              {
                                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
                                value: selectedConnection.key.access_key_id,
                              },
                            ].map((item) => (
                              <div key={item.label}>
                                <dt className={uiMutedTextClass}>{item.label}</dt>
                                <dd className={cx("mt-1 break-all font-mono font-semibold", uiTitleTextClass)}>{item.value}</dd>
                                <UiButton
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  className="mt-1"
                                  onClick={() => void handleCopyConnectionValue(item.value)}
                                  aria-label={`${t({ en: "Copy", fr: "Copier", de: "Kopieren" })} ${item.label}: ${item.value}`}
                                >
                                  {t({ en: "Copy", fr: "Copier", de: "Kopieren" })}
                                </UiButton>
                              </div>
                            ))}
                            <div>
                              <dt className={uiMutedTextClass}>{t({ en: "Addressing mode", fr: "Mode d'adressage", de: "Adressierungsmodus" })}</dt>
                              <dd className={cx("mt-1 font-semibold", uiTitleTextClass)}>
                                {selectedConnection.forcePathStyle
                                  ? t({ en: "Path-style", fr: "Style chemin", de: "Pfadstil" })
                                  : t({ en: "Virtual-hosted style", fr: "Style hôte virtuel", de: "Virtueller Hoststil" })}
                              </dd>
                            </div>
                          </dl>
                          <div className="flex flex-wrap items-center gap-3">
                            <UiButton
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={handleDownloadConnectionSheet}
                              aria-label={`${t({ en: "Download connection details (.txt) for", fr: "Télécharger les détails de connexion (.txt) pour", de: "Verbindungsdetails (.txt) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                            >
                              {t({ en: "Download connection details (.txt)", fr: "Télécharger les détails de connexion (.txt)", de: "Verbindungsdetails herunterladen (.txt)" })}
                            </UiButton>
                          </div>
                        </section>
                      </div>
                    </details>
                  </>
                ) : null}
              </>
            )}
          </div>
        </SettingsDialog>
  );
}
