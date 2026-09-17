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
      if (active) { setConnectionSpaces([]); setConnectionSpacesError(extractApiError(cause, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden.", zh: "无法加载空间。" }))); }
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
  const connectionEndpointLabel = selectedConnection?.endpoint?.original || endpoint || t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst", zh: "已配置的存储服务" });
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
      setMessage(t({ en: "Cyberduck bookmark download needs a valid service address.", fr: "Le téléchargement du favori Cyberduck nécessite une adresse de service valide.", de: "Der Cyberduck-Bookmark benötigt eine gültige Serviceadresse.", zh: "下载 Cyberduck 书签需要有效的服务地址。" }));
      return;
    }
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.duck`;
    triggerPortalExternalToolDownload(filename, buildCyberduckBookmark(selectedConnection), "application/xml;charset=utf-8");
    setMessage(t({ en: "Cyberduck bookmark downloaded.", fr: "Favori Cyberduck téléchargé.", de: "Cyberduck-Bookmark heruntergeladen.", zh: "已下载 Cyberduck 书签。" }));
  };

  const handleDownloadWinScpProfile = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-winscp.ini`;
    triggerPortalExternalToolDownload(filename, buildWinScpProfile(selectedConnection), "text/plain;charset=utf-8");
    setMessage(t({ en: "WinSCP profile downloaded.", fr: "Profil WinSCP téléchargé.", de: "WinSCP-Profil heruntergeladen.", zh: "已下载 WinSCP 配置。" }));
  };

  const handleDownloadRcloneConfig = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-rclone.conf`;
    triggerPortalExternalToolDownload(filename, buildRcloneConfig(selectedConnection), "text/plain;charset=utf-8");
    setMessage(t({ en: "rclone configuration downloaded.", fr: "Configuration rclone téléchargée.", de: "rclone-Konfiguration heruntergeladen.", zh: "已下载 rclone 配置。" }));
  };

  const handleDownloadConnectionSheet = () => {
    if (!selectedConnection) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.txt`;
    triggerPortalExternalToolDownload(
      filename,
      buildGenericConnectionSheet(selectedConnection),
      "text/plain;charset=utf-8"
    );
    setMessage(t({ en: "Connection details downloaded.", fr: "Détails de connexion téléchargés.", de: "Verbindungsdetails heruntergeladen.", zh: "已下载连接信息。" }));
  };

  const handleCopyConnectionValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t({ en: "Value copied.", fr: "Valeur copiée.", de: "Wert kopiert.", zh: "已复制。" }));
    } catch {
      setMessage(t({ en: "Unable to copy this value.", fr: "Impossible de copier cette valeur.", de: "Dieser Wert kann nicht kopiert werden.", zh: "无法复制此值。" }));
    }
  };

  return (
        <SettingsDialog
          title={t({ en: "Connect a tool", fr: "Connecter un outil", de: "Werkzeug verbinden", zh: "连接工具" })}
          titleAs="h2"
          onClose={onClose}
          closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen", zh: "关闭" })}
          closeAriaLabel={t({ en: "Close modal", fr: "Fermer la fenêtre", de: "Dialog schließen", zh: "关闭对话框" })}
        >
          <div className="settings-stack settings-fields">
            {message && <div className="sticky top-0 z-10 bg-[var(--ui-surface)]">
              <UiInlineMessage tone="info" role="status">{message}</UiInlineMessage>
            </div>}
            {activeKeys.length === 0 ? (
              <PageEmptyState
                eyebrow={t({ en: "Access required", fr: "Accès requis", de: "Zugriff erforderlich", zh: "需要访问凭据" })}
                title={t({ en: "Create an active tool access first", fr: "Créez d'abord un accès outil actif", de: "Erstellen Sie zuerst einen aktiven Werkzeugzugriff", zh: "请先创建已启用的工具访问凭据" })}
                description={t({
                  en: "The configuration identifies which permissions the application will use.",
                  fr: "La configuration doit indiquer quels droits l'application utilisera.",
                  de: "Die Konfiguration muss festlegen, welche Berechtigungen die Anwendung verwendet.",
                  zh: "此配置决定应用使用的权限。",
                })}
                primaryAction={onCreate ? {
                  label: t({ en: "Create tool access", fr: "Créer un accès outil", de: "Werkzeugzugriff erstellen", zh: "创建工具访问凭据" }),
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
                    {t({ en: "Connection", fr: "Connexion", de: "Verbindung", zh: "连接" })}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <UiSelect label={t({ en: "Access used", fr: "Accès utilisé", de: "Verwendeter Zugriff", zh: "使用的访问凭据" })}
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
                        <span className={uiLabelClass}>{t({ en: "Space", fr: "Space", de: "Space", zh: "空间" })}</span>
                        <p className={cx("min-h-10 rounded-lg border px-3 py-2 ui-body", uiPanelMutedClass, uiTitleTextClass)}>
                          {selectedConnectionKey?.storage_space_name || selectedConnection?.storageSpaceName || selectedConnectionKeyBucket}
                          {" — "}
                          {t({
                            en: "fixed when this access was created",
                            fr: "défini lors de la création de cet accès",
                            de: "bei der Erstellung dieses Zugriffs festgelegt",
                            zh: "创建此访问凭据时已确定",
                          })}
                        </p>
                      </div>
                    ) : (
                      <UiSelect label={t({ en: "Space", fr: "Space", de: "Space", zh: "空间" })}
                          value={selectedConnectionSpace?.id ?? ""}
                          onChange={(event) => onSelectionChange({ ...selection, spaceId: event.target.value })}
                          disabled={connectionSpacesLoading || connectionSpaces.length === 0}
                        >
                          {connectionSpacesLoading ? (
                            <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen...", zh: "正在加载…" })}</option>
                          ) : connectionSpaces.length === 0 ? (
                            <option value="">{t({ en: "No Space", fr: "Aucun Space", de: "Kein Space", zh: "没有空间" })}</option>
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
                  <UiInlineMessage tone="warning">{connectionSpacesError} {" "}<UiButton variant="secondary" onClick={() => setRevision(value => value + 1)}>{t({ en: "Retry", fr: "Réessayer", de: "Erneut versuchen", zh: "重试" })}</UiButton></UiInlineMessage>
                ) : null}
                {selectedConnectionHasNoSpace ? (
                  <PageEmptyState
                    eyebrow={t({ en: "Space required", fr: "Space requis", de: "Space erforderlich", zh: "需要空间" })}
                    title={t({ en: "Create a Space to continue", fr: "Créez un Space pour continuer", de: "Erstellen Sie einen Space, um fortzufahren", zh: "创建空间以继续" })}
                    description={t({
                      en: "The application needs a Space to use as its initial folder.",
                      fr: "L'application a besoin d'un Space comme dossier initial.",
                      de: "Die Anwendung benötigt einen Space als Startordner.",
                      zh: "应用需要一个空间作为初始文件夹。",
                    })}
                    primaryAction={{
                      label: t({ en: "Create a Space", fr: "Créer un Space", de: "Space erstellen", zh: "创建空间" }),
                      to: "/portal/storage-spaces?create=1",
                    }}
                  />
                ) : selectedConnection ? (
                  <>
                    <section className="settings-section-compact" aria-labelledby="portal-tool-application-section">
                      <div>
                        <h3 id="portal-tool-application-section" className="settings-section-title">
                          {t({ en: "Choose your application", fr: "Choisissez votre application", de: "Wählen Sie Ihre Anwendung", zh: "选择应用" })}
                        </h3>
                        <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                          {t({
                            en: "Install the application first if you do not already have it, then import the downloaded file.",
                            fr: "Installez d'abord l'application si nécessaire, puis importez le fichier téléchargé.",
                            de: "Installieren Sie die Anwendung bei Bedarf zuerst und importieren Sie dann die heruntergeladene Datei.",
                            zh: "如果尚未安装应用，请先安装，再导入下载的文件。",
                          })}
                        </p>
                      </div>
                      <div className="settings-stack">
                        <article className="settings-stack min-w-0">
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>Cyberduck / Mountain Duck</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>
                              {t({ en: "macOS and Windows", fr: "macOS et Windows", de: "macOS und Windows", zh: "macOS 和 Windows" })}
                            </p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Browse files or mount the Space like a disk.",
                                fr: "Parcourez les fichiers ou montez le Space comme un disque.",
                                de: "Durchsuchen Sie Dateien oder binden Sie den Space wie ein Laufwerk ein.",
                                zh: "浏览文件或将空间挂载为磁盘。",
                              })}
                            </p>
                            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://cyberduck.io/download/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Cyberduck from the official site (opens in a new tab)", fr: "Installer Cyberduck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Cyberduck von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 Cyberduck（在新标签页中打开）" })}
                              >
                                {t({ en: "Install Cyberduck", fr: "Installer Cyberduck", de: "Cyberduck installieren", zh: "安装 Cyberduck" })}
                              </a>
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://mountainduck.io/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Mountain Duck from the official site (opens in a new tab)", fr: "Installer Mountain Duck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Mountain Duck von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 Mountain Duck（在新标签页中打开）" })}
                              >
                                {t({ en: "Install Mountain Duck", fr: "Installer Mountain Duck", de: "Mountain Duck installieren", zh: "安装 Mountain Duck" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="self-start"
                            variant="secondary"
                            onClick={handleDownloadCyberduckBookmark}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download Cyberduck or Mountain Duck configuration (.duck) for", fr: "Télécharger la configuration Cyberduck ou Mountain Duck (.duck) pour", de: "Cyberduck- oder Mountain-Duck-Konfiguration (.duck) herunterladen für", zh: "下载 Cyberduck 或 Mountain Duck 配置（.duck），适用于" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download configuration (.duck)", fr: "Télécharger la configuration (.duck)", de: "Konfiguration herunterladen (.duck)", zh: "下载配置（.duck）" })}
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
                                zh: "通过图形界面传输文件。",
                              })}
                            </p>
                            <p className="mt-3 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://winscp.net/eng/download.php"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install WinSCP from the official site (opens in a new tab)", fr: "Installer WinSCP depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "WinSCP von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 WinSCP（在新标签页中打开）" })}
                              >
                                {t({ en: "Install WinSCP", fr: "Installer WinSCP", de: "WinSCP installieren", zh: "安装 WinSCP" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="self-start"
                            variant="secondary"
                            onClick={handleDownloadWinScpProfile}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download WinSCP profile (.ini) for", fr: "Télécharger le profil WinSCP (.ini) pour", de: "WinSCP-Profil (.ini) herunterladen für", zh: "下载 WinSCP 配置（.ini），适用于" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download WinSCP profile (.ini)", fr: "Télécharger le profil WinSCP (.ini)", de: "WinSCP-Profil herunterladen (.ini)", zh: "下载 WinSCP 配置（.ini）" })}
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
                          zh: "存储服务地址无效，无法下载配置。请检查手动配置值或联系管理员。",
                        })}
                      </UiInlineMessage>
                    ) : null}

                    <details className="group border-t border-[var(--ui-border-soft)] pt-3">
                      <summary className={cx("cursor-pointer ui-body font-semibold", uiTitleTextClass)}>
                        {t({ en: "Advanced tools and manual setup", fr: "Outils avancés et configuration manuelle", de: "Erweiterte Werkzeuge und manuelle Einrichtung", zh: "高级工具和手动配置" })}
                      </summary>
                      <div className="settings-stack mt-3">
                        <section className="space-y-3" aria-labelledby="portal-rclone-setup">
                          <div>
                            <h4 id="portal-rclone-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>rclone</h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({ en: "Command line and automation.", fr: "Ligne de commande et automatisation.", de: "Kommandozeile und Automatisierung.", zh: "命令行与自动化。" })}
                              {" "}
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://rclone.org/downloads/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install rclone from the official site (opens in a new tab)", fr: "Installer rclone depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "rclone von der offiziellen Website installieren (öffnet einen neuen Tab)", zh: "从官方网站安装 rclone（在新标签页中打开）" })}
                              >
                                {t({ en: "Install rclone", fr: "Installer rclone", de: "rclone installieren", zh: "安装 rclone" })}
                              </a>
                            </p>
                          </div>
                          <div className="grid gap-2 ui-caption">
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Secret environment variable", fr: "Variable d'environnement du secret", de: "Umgebungsvariable für das Secret", zh: "私有密钥环境变量" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>{rcloneSecretEnvironmentVariable}</code>
                            </div>
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Example command", fr: "Commande d'exemple", de: "Beispielbefehl", zh: "命令示例" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>rclone lsd {rcloneRemoteName}:{selectedConnection.bucketName}</code>
                            </div>
                          </div>
                          <UiButton
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleDownloadRcloneConfig}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download rclone configuration (.conf) for", fr: "Télécharger la configuration rclone (.conf) pour", de: "rclone-Konfiguration (.conf) herunterladen für", zh: "下载 rclone 配置（.conf），适用于" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download rclone configuration (.conf)", fr: "Télécharger la configuration rclone (.conf)", de: "rclone-Konfiguration herunterladen (.conf)", zh: "下载 rclone 配置（.conf）" })}
                          </UiButton>
                        </section>

                        <section className="space-y-3 border-t border-[var(--ui-border-soft)] pt-3" aria-labelledby="portal-manual-s3-setup">
                          <div>
                            <h4 id="portal-manual-s3-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                              {t({ en: "Other S3-compatible application", fr: "Autre application compatible S3", de: "Andere S3-kompatible Anwendung", zh: "其他兼容 S3 的应用" })}
                            </h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Enter the secret in the application when requested. It is never included in these downloads.",
                                fr: "Saisissez le secret dans l'application lorsqu'il est demandé. Il n'est jamais inclus dans ces téléchargements.",
                                de: "Geben Sie das Secret auf Nachfrage in der Anwendung ein. Es ist nie in diesen Downloads enthalten.",
                                zh: "在应用提示时输入私有密钥。下载文件中不会包含私有密钥。",
                              })}
                            </p>
                          </div>
                          <dl className="grid gap-3 ui-caption sm:grid-cols-2">
                            {[
                              {
                                label: t({ en: "S3 endpoint", fr: "Endpoint S3", de: "S3-Endpunkt", zh: "S3 端点" }),
                                value: connectionEndpointLabel,
                              },
                              {
                                label: t({ en: "Bucket", fr: "Bucket", de: "Bucket", zh: "存储桶" }),
                                value: selectedConnection.bucketName,
                              },
                              {
                                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID", zh: "访问密钥 ID" }),
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
                                  aria-label={`${t({ en: "Copy", fr: "Copier", de: "Kopieren", zh: "复制" })} ${item.label}: ${item.value}`}
                                >
                                  {t({ en: "Copy", fr: "Copier", de: "Kopieren", zh: "复制" })}
                                </UiButton>
                              </div>
                            ))}
                            <div>
                              <dt className={uiMutedTextClass}>{t({ en: "Addressing mode", fr: "Mode d'adressage", de: "Adressierungsmodus", zh: "寻址模式" })}</dt>
                              <dd className={cx("mt-1 font-semibold", uiTitleTextClass)}>
                                {selectedConnection.forcePathStyle
                                  ? t({ en: "Path-style", fr: "Style chemin", de: "Pfadstil", zh: "路径样式" })
                                  : t({ en: "Virtual-hosted style", fr: "Style hôte virtuel", de: "Virtueller Hoststil", zh: "虚拟主机样式" })}
                              </dd>
                            </div>
                          </dl>
                          <div className="flex flex-wrap items-center gap-3">
                            <UiButton
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={handleDownloadConnectionSheet}
                              aria-label={`${t({ en: "Download connection details (.txt) for", fr: "Télécharger les détails de connexion (.txt) pour", de: "Verbindungsdetails (.txt) herunterladen für", zh: "下载连接信息（.txt），适用于" })} ${selectedConnection.storageSpaceName}`}
                            >
                              {t({ en: "Download connection details (.txt)", fr: "Télécharger les détails de connexion (.txt)", de: "Verbindungsdetails herunterladen (.txt)", zh: "下载连接信息（.txt）" })}
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
