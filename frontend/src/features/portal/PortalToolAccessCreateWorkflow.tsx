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
  accountId, options, personalAccessLimitReached, maxAccessKeys, busy, error, disabled, onCreate, onClose,
}: {
  accountId: S3AccountSelector;
  options: PortalToolAccessCreateOptions;
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
    if (target !== "external" || !accountId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    void listPortalStorageSpaces(accountId, { sort: "name" }).then(result => {
      if (active) setSpaces(result.filter(space => (space.role === "Owner" || space.role === "Manager") && !space.archived_at));
    }).catch(cause => {
      if (active) {
        setSpaces([]);
        setLoadError(extractApiError(cause, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden." })));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, target, revision, t]);
  const initialSpace = spaces.find(space => space.id === options.spaceId || space.internal_bucket_name === options.spaceId) ?? spaces[0] ?? null;
  const selectedSpace = spaceId === null ? initialSpace : spaces.find(space => space.id === spaceId) ?? null;
  const dirty = target !== options.target || Boolean(externalLabel) || permission !== "read_only" ||
    (spaceId !== null && spaceId !== initialSpace?.id);
  const submitDisabled = disabled || !accountId || (target === "self" ? personalAccessLimitReached
    : !externalLabel.trim() || !selectedSpace || loading || Boolean(loadError));
  const myself = t({ en: "For myself", fr: "Pour moi-même", de: "Für mich" });
  const external = t({ en: "For an external user", fr: "Pour un utilisateur externe", de: "Für einen externen Benutzer" });
  const readOnly = t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen" });
  const readWrite = t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben" });
  return <SettingsWorkflowForm
    title={t({ en: "Create S3 tool access", fr: "Créer un accès outil S3", de: "S3-Werkzeugzugriff erstellen" })}
    description={t({
      en: "Choose the recipient, space and permissions. Save the secret when the access is created; it is shown only once.",
      fr: "Choisissez le destinataire, l’espace et les droits. Enregistrez le secret à la création : il n’est affiché qu’une fois.",
      de: "Wählen Sie Empfänger, Bereich und Rechte. Speichern Sie das Secret beim Erstellen; es wird nur einmal angezeigt.",
    })}
    breadcrumbs={portalBreadcrumbs({ label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" }), to: "/portal/access-keys" },
      { label: t({ en: "Create", fr: "Créer", de: "Erstellen" }) })}
    backLabel={t({ en: "Back to tool access", fr: "Retour aux accès outil", de: "Zurück zum Werkzeugzugriff" })}
    contentVariant="plain" dirty={dirty} busy={busy} error={error} disabled={submitDisabled} onClose={onClose}
    submitLabel={t({ en: "Create access", fr: "Créer l'accès", de: "Zugriff erstellen" })}
    busyLabel={t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })}
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
    })}</p>
    <SettingsSection title={t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" })} presentation="compact">
      <fieldset className="min-w-0">
        <legend className="sr-only">{t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" })}</legend>
        <SettingsChoiceRow type="radio" name={`${groupId}-target`} title={myself} ariaLabel={myself}
          checked={target === "self"} onChange={() => setTarget("self")} disabled={personalAccessLimitReached}
          description={t({ en: "Uses my current Portal grants.", fr: "Utilise mes droits Portal actuels.", de: "Verwendet meine aktuellen Portal-Berechtigungen." })} />
        <SettingsChoiceRow type="radio" name={`${groupId}-target`} title={external} ariaLabel={external}
          checked={target === "external"} onChange={() => setTarget("external")}
          description={t({ en: "Limits tool access to one space.", fr: "Limite l'accès outil à un seul espace.", de: "Beschränkt den Werkzeugzugriff auf einen Bereich." })} />
      </fieldset>
      {personalAccessLimitReached && <UiInlineMessage tone="info">{t({
        en: `Your personal IAM user already has the maximum of ${maxAccessKeys} S3 access keys. You can still create access for an external user because it uses a separate IAM user.`,
        fr: `Votre utilisateur IAM personnel a déjà atteint la limite de ${maxAccessKeys} clés d'accès S3. Vous pouvez toutefois créer un accès pour un utilisateur externe.`,
        de: `Ihr persönlicher IAM-Benutzer hat bereits das Maximum von ${maxAccessKeys} S3-Zugriffsschlüsseln. Für externe Benutzer können Sie weiterhin Zugriff erstellen, da dafür ein separater IAM-Benutzer verwendet wird.`,
      })}</UiInlineMessage>}
    </SettingsSection>
    {target === "external" && <SettingsSection title={t({ en: "Access", fr: "Accès", de: "Zugriff" })} presentation="compact">
      <div className="settings-fields">
        <UiInput label={t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer" })}
          value={externalLabel} onChange={event => setExternalLabel(event.target.value)} required maxLength={254}
          placeholder={t({ en: "name@example.org", fr: "nom@example.org", de: "name@example.org" })} />
        <UiSelect label={t({ en: "Space", fr: "Espace", de: "Bereich" })} value={selectedSpace?.id ?? ""}
          onChange={event => setSpaceId(event.target.value)} disabled={loading || Boolean(loadError) || !spaces.length}>
          {loading ? <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</option>
            : !spaces.length ? <option value="">{t({ en: "No owned space", fr: "Aucun espace propriétaire", de: "Kein eigener Bereich" })}</option>
            : spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
        </UiSelect>
        {loadError && <UiInlineMessage tone="error" role="alert">{loadError} {" "}
          <SettingsButton variant="secondary" onClick={() => setRevision(value => value + 1)}>{t({ en: "Retry", fr: "Réessayer", de: "Erneut versuchen" })}</SettingsButton>
        </UiInlineMessage>}
        <fieldset className="min-w-0">
          <legend className="settings-label mb-3">{t({ en: "Permission", fr: "Droits", de: "Berechtigung" })}</legend>
          <SettingsChoiceRow type="radio" name={`${groupId}-permission`} title={readOnly} ariaLabel={readOnly}
            checked={permission === "read_only"} onChange={() => setPermission("read_only")}
            description={t({ en: "List and download.", fr: "Lister et télécharger.", de: "Auflisten und herunterladen." })} />
          <SettingsChoiceRow type="radio" name={`${groupId}-permission`} title={readWrite} ariaLabel={readWrite}
            checked={permission === "read_write"} onChange={() => setPermission("read_write")}
            description={t({ en: "List, download, upload, and delete.", fr: "Lister, télécharger, déposer et supprimer.", de: "Auflisten, herunterladen, hochladen und löschen." })} />
        </fieldset>
      </div>
    </SettingsSection>}
  </SettingsWorkflowForm>;
}
