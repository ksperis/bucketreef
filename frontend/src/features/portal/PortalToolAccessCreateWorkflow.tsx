/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useId, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { listPortalStorageSpaces, type PortalStorageSpaceSummary } from "../../api/portal";
import type { PortalAccessKeyCreate } from "../../api/portalAccessKeys";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsChoiceRow, SettingsSection } from "../../components/settings/SettingsLayout";
import { SettingsButton } from "../../components/settings/SettingsControls";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { portalBreadcrumbs } from "./portalBreadcrumbs";

export type PortalToolAccessCreateOptions = { target: "self" | "external"; spaceId?: string };

export default function PortalToolAccessCreateWorkflow({
  accountId, options, personalAccessEnabled, externalAccessEnabled, personalAccessLimitReached, maxAccessKeys, busy, error, disabled, onCreate, onClose,
}: {
  accountId: S3AccountSelector;
  options: PortalToolAccessCreateOptions;
  personalAccessEnabled: boolean;
  externalAccessEnabled: boolean;
  personalAccessLimitReached: boolean;
  maxAccessKeys: number;
  busy: boolean;
  error: string | null;
  disabled: boolean;
  onCreate: (payload: PortalAccessKeyCreate, space: PortalStorageSpaceSummary | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const groupId = useId();
  const [target, setTarget] = useState(options.target);
  const [externalLabel, setExternalLabel] = useState("");
  const [permission, setPermission] = useState<"read_only" | "read_write">("read_only");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<PortalStorageSpaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (target !== "external" || !externalAccessEnabled || !accountId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    void listPortalStorageSpaces(accountId, { sort: "name" }).then(result => {
      if (active) setSpaces(result.filter(space => (space.role === "Owner" || space.role === "Manager") && !space.archived_at));
    }).catch(cause => {
      if (active) {
        setSpaces([]);
        setLoadError(extractApiError(cause, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden.", zh: "无法加载空间。" })));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, externalAccessEnabled, target, revision, t]);
  const initialSpace = spaces.find(space => space.id === options.spaceId || space.internal_bucket_name === options.spaceId) ?? spaces[0] ?? null;
  const selectedSpace = spaceId === null ? initialSpace : spaces.find(space => space.id === spaceId) ?? null;
  const dirty = target !== options.target || Boolean(externalLabel) || permission !== "read_only" ||
    (spaceId !== null && spaceId !== initialSpace?.id);
  const submitDisabled = disabled || !accountId || (target === "self"
    ? !personalAccessEnabled || personalAccessLimitReached
    : !externalAccessEnabled || !externalLabel.trim() || !selectedSpace || loading || Boolean(loadError));
  const myself = t({ en: "For myself", fr: "Pour moi-même", de: "Für mich", zh: "为自己创建" });
  const external = t({ en: "For an external user", fr: "Pour un utilisateur externe", de: "Für einen externen Benutzer", zh: "为外部用户创建" });
  const readOnly = t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen", zh: "只读" });
  const readWrite = t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben", zh: "读写" });
  return <SettingsWorkflowForm
    title={t({ en: "Create S3 tool access", fr: "Créer un accès outil S3", de: "S3-Werkzeugzugriff erstellen", zh: "创建 S3 工具访问凭据" })}
    description={t({
      en: "Choose the recipient, space and permissions. Save the secret when the access is created; it is shown only once.",
      fr: "Choisissez le destinataire, l’espace et les droits. Enregistrez le secret à la création : il n’est affiché qu’une fois.",
      de: "Wählen Sie Empfänger, Bereich und Rechte. Speichern Sie das Secret beim Erstellen; es wird nur einmal angezeigt.",
      zh: "选择接收者、空间和权限。创建访问权限后请保存密钥；密钥仅显示一次。",
    })}
    breadcrumbs={portalBreadcrumbs({ label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge", zh: "外部工具" }), to: "/portal/access-keys" },
      { label: t({ en: "Create", fr: "Créer", de: "Erstellen", zh: "创建" }) })}
    backLabel={t({ en: "Back to tool access", fr: "Retour aux accès outil", de: "Zurück zum Werkzeugzugriff", zh: "返回工具访问" })}
    contentVariant="plain" dirty={dirty} busy={busy} error={error} disabled={submitDisabled} onClose={onClose}
    submitLabel={t({ en: "Create access", fr: "Créer l'accès", de: "Zugriff erstellen", zh: "创建访问凭据" })}
    busyLabel={t({ en: "Creating...", fr: "Création...", de: "Wird erstellt...", zh: "正在创建…" })}
    onSubmit={async () => {
      if (submitDisabled) return;
      await onCreate(target === "self" ? { target_type: "self" } : {
        target_type: "external", storage_space_id: selectedSpace!.id, external_email: externalLabel.trim(), permission,
      }, selectedSpace);
    }}>
    <p className="settings-description">{t({
      en: "If the recipient can sign in to Portal, share the space there. Tool access is for desktop applications, scripts and direct S3 clients.",
      fr: "Si le destinataire peut se connecter à Portal, partagez l’espace dans Portal. Les accès outil sont destinés aux applications de bureau, scripts et clients S3 directs.",
      de: "Kann sich der Empfänger bei Portal anmelden, geben Sie den Bereich dort frei. Werkzeugzugriff ist für Desktop-Apps, Skripte und direkte S3-Clients gedacht.",
      zh: "如果接收者可以登录 Portal，请在 Portal 中共享空间。工具访问用于桌面应用、脚本和直接连接 S3 的客户端。",
    })}</p>
    <SettingsSection title={t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" })} presentation="compact">
      <fieldset className="min-w-0">
        <legend className="sr-only">{t({ en: "Recipient", fr: "Destinataire", de: "Empfänger", zh: "接收人" })}</legend>
        <SettingsChoiceRow type="radio" name={`${groupId}-target`} title={myself} ariaLabel={myself}
          checked={target === "self"} onChange={() => setTarget("self")} disabled={!personalAccessEnabled || personalAccessLimitReached}
          description={t({ en: "Uses my current Portal grants.", fr: "Utilise mes droits Portal actuels.", de: "Verwendet meine aktuellen Portal-Berechtigungen.", zh: "使用我当前的 Portal 授权。" })} />
        <SettingsChoiceRow type="radio" name={`${groupId}-target`} title={external} ariaLabel={external}
          checked={target === "external"} onChange={() => setTarget("external")} disabled={!externalAccessEnabled}
          description={t({ en: "Limits tool access to one space.", fr: "Limite l'accès outil à un seul espace.", de: "Beschränkt den Werkzeugzugriff auf einen Bereich.", zh: "将工具访问限制为一个空间。" })} />
      </fieldset>
      {personalAccessLimitReached && externalAccessEnabled && <UiInlineMessage tone="info">{t({
        en: `Your personal IAM user already has the maximum of ${maxAccessKeys} S3 access keys. You can still create access for an external user because it uses a separate IAM user.`,
        fr: `Votre utilisateur IAM personnel a déjà atteint la limite de ${maxAccessKeys} clés d'accès S3. Vous pouvez toutefois créer un accès pour un utilisateur externe.`,
        de: `Ihr persönlicher IAM-Benutzer hat bereits das Maximum von ${maxAccessKeys} S3-Zugriffsschlüsseln. Für externe Benutzer können Sie weiterhin Zugriff erstellen, da dafür ein separater IAM-Benutzer verwendet wird.`,
        zh: `你的个人 IAM 用户已达到 ${maxAccessKeys} 个 S3 访问密钥的上限。你仍可为外部用户创建访问凭据，因为它使用独立的 IAM 用户。`,
      })}</UiInlineMessage>}
    </SettingsSection>
    {target === "external" && <SettingsSection title={t({ en: "Access", fr: "Accès", de: "Zugriff", zh: "访问权限" })} presentation="compact">
      <div className="settings-fields">
        <UiInput label={t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer", zh: "外部用户" })}
          value={externalLabel} onChange={event => setExternalLabel(event.target.value)} required maxLength={254}
          placeholder={t({ en: "name@example.org", fr: "nom@example.org", de: "name@example.org", zh: "name@example.org" })} />
        <UiSelect label={t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" })} value={selectedSpace?.id ?? ""}
          onChange={event => setSpaceId(event.target.value)} disabled={loading || Boolean(loadError) || !spaces.length}>
          {loading ? <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen...", zh: "正在加载…" })}</option>
            : !spaces.length ? <option value="">{t({ en: "No owned space", fr: "Aucun espace propriétaire", de: "Kein eigener Bereich", zh: "没有自己拥有的空间" })}</option>
            : spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
        </UiSelect>
        {loadError && <UiInlineMessage tone="error" role="alert">{loadError} {" "}
          <SettingsButton variant="secondary" onClick={() => setRevision(value => value + 1)}>{t({ en: "Retry", fr: "Réessayer", de: "Erneut versuchen", zh: "重试" })}</SettingsButton>
        </UiInlineMessage>}
        <fieldset className="min-w-0">
          <legend className="settings-label mb-3">{t({ en: "Permission", fr: "Droits", de: "Berechtigung", zh: "权限" })}</legend>
          <SettingsChoiceRow type="radio" name={`${groupId}-permission`} title={readOnly} ariaLabel={readOnly}
            checked={permission === "read_only"} onChange={() => setPermission("read_only")}
            description={t({ en: "List and download.", fr: "Lister et télécharger.", de: "Auflisten und herunterladen.", zh: "列出和下载。" })} />
          <SettingsChoiceRow type="radio" name={`${groupId}-permission`} title={readWrite} ariaLabel={readWrite}
            checked={permission === "read_write"} onChange={() => setPermission("read_write")}
            description={t({ en: "List, download, upload, and delete.", fr: "Lister, télécharger, déposer et supprimer.", de: "Auflisten, herunterladen, hochladen und löschen.", zh: "列出、下载、上传和删除。" })} />
        </fieldset>
      </div>
    </SettingsSection>}
  </SettingsWorkflowForm>;
}
