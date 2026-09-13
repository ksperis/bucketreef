/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import {
  type PortalStorageSpaceCreate,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceGrantRole,
  type PortalStorageSpaceShareScope,
  type PortalStorageSpaceVisibility,
} from "../../api/portal";
import type { PortalStorageSpaceShareCandidate } from "../../api/portalSharing";
import ListToolbar from "../../components/ListToolbar";
import PortalCollaboratorRequestDialog from "./PortalCollaboratorRequestDialog";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiBadge from "../../components/ui/UiBadge";
import { SettingsButton as UiButton } from "../../components/settings/SettingsControls";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import {
  portalAccessSourceLabel,
  portalAccountRoleLabel,
  portalRoleLabel,
  portalShareScopeLabel,
} from "./portalI18n";
import { portalRoleTone } from "./portalUi";

export type PortalAccessMode = "private" | "account" | "restricted";
type PortalSelectedShare = { user_id: number; role: PortalStorageSpaceGrantRole };

export function portalAccessModeFromParts(
  visibility?: PortalStorageSpaceVisibility | null,
  shareScope?: PortalStorageSpaceShareScope | null,
): PortalAccessMode {
  if (visibility !== "shared") return "private";
  return shareScope === "account" ? "account" : "restricted";
}

export function portalAccessPayloadFromMode(
  mode: PortalAccessMode,
  accountMemberRole?: PortalStorageSpaceAccountMemberRole | null,
): Pick<PortalStorageSpaceCreate, "visibility" | "share_scope" | "account_member_role"> {
  return {
    visibility: mode === "private" ? "private" : "shared",
    share_scope: mode === "account" ? "account" : "restricted",
    account_member_role: mode === "account" ? accountMemberRole ?? "Editor" : null,
  };
}

export function portalAccessModeDescription(mode: PortalAccessMode, t: ReturnType<typeof useI18n>["t"]): string {
  if (mode === "account") {
    return t({
      en: "Everyone already added to this account can work in the space automatically.",
      fr: "Toutes les personnes déjà ajoutées à ce compte peuvent travailler dans cet espace automatiquement.",
      de: "Alle bereits zu diesem Konto hinzugefügten Personen können automatisch in diesem Bereich arbeiten.",
    });
  }
  if (mode === "restricted") {
    return t({
      en: "Only the people you choose can work in this space.",
      fr: "Seules les personnes que vous choisissez peuvent travailler dans cet espace.",
      de: "Nur die von Ihnen ausgewählten Personen können in diesem Bereich arbeiten.",
    });
  }
  return t({
    en: "Only you and project managers can access this space.",
    fr: "Seuls vous et les gestionnaires du projet pouvez accéder à cet espace.",
    de: "Nur Sie und die Projektmanager können auf diesen Bereich zugreifen.",
  });
}

export function portalAccessModeSummary(
  mode: PortalAccessMode,
  selectedCount: number,
  memberCount: number | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (mode === "account") {
    if (memberCount != null) {
      return t({
        en: `Team: ${memberCount} member${memberCount > 1 ? "s" : ""}`,
        fr: `Équipe : ${memberCount} membre${memberCount > 1 ? "s" : ""}`,
        de: `Team: ${memberCount} Mitglied${memberCount > 1 ? "er" : ""}`,
      });
    }
    return t({ en: "Team: all account members", fr: "Équipe : tous les membres du compte", de: "Team: alle Kontomitglieder" });
  }
  if (mode === "restricted") {
    return t({
      en: `Selected people: ${selectedCount}`,
      fr: `Personnes choisies : ${selectedCount}`,
      de: `Ausgewählte Personen: ${selectedCount}`,
    });
  }
  return t({ en: "Private: you and project managers", fr: "Privé : vous et les gestionnaires du projet", de: "Privat: Sie und Projektmanager" });
}

export function PortalAccessModeFields({
  mode,
  onModeChange,
  accountMemberRole,
  onAccountMemberRoleChange,
  disabled = false,
  modeLocked = false,
  allowedModes = ["private", "account", "restricted"],
  modeLabel,
  roleLabel,
}: {
  mode: PortalAccessMode;
  onModeChange: (mode: PortalAccessMode) => void;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
  onAccountMemberRoleChange: (role: PortalStorageSpaceAccountMemberRole) => void;
  disabled?: boolean;
  modeLocked?: boolean;
  allowedModes?: PortalAccessMode[];
  modeLabel: string;
  roleLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cx("settings-fields", mode === "account" && "md:grid-cols-2")}>
      <UiSelect
        label={modeLabel}
        value={mode}
        onChange={(event) => onModeChange(event.target.value as PortalAccessMode)}
        disabled={disabled || modeLocked}
      >
        {allowedModes.includes("private") ? <option value="private">{portalShareScopeLabel("private", "restricted", t)}</option> : null}
        {allowedModes.includes("account") ? <option value="account">{portalShareScopeLabel("shared", "account", t)}</option> : null}
        {allowedModes.includes("restricted") ? <option value="restricted">{portalShareScopeLabel("shared", "restricted", t)}</option> : null}
      </UiSelect>
      {mode === "account" && <UiSelect
        label={roleLabel}
        value={accountMemberRole}
        onChange={(event) => onAccountMemberRoleChange(event.target.value as PortalStorageSpaceAccountMemberRole)}
        disabled={disabled}
      >
        <option value="Editor">{portalRoleLabel("Editor", t)}</option>
        <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
      </UiSelect>}
      <div className={cx("settings-description", mode === "account" && "md:col-span-2")}>
        {portalAccessModeDescription(mode, t)}
      </div>
    </div>
  );
}

export function PortalShareCandidatePicker({
  candidates,
  selectedRolesByUserId,
  existingRolesByUserId = {},
  query,
  loading = false,
  error,
  includeAlreadyShared = false,
  onQueryChange,
  onRoleChange,
  onRequestPerson,
  onRequestDraftStateChange,
  onRetry,
}: {
  candidates: PortalStorageSpaceShareCandidate[];
  selectedRolesByUserId: Record<number, PortalStorageSpaceGrantRole>;
  existingRolesByUserId?: Record<number, PortalStorageSpaceGrantRole>;
  query: string;
  loading?: boolean;
  error?: string | null;
  includeAlreadyShared?: boolean;
  onQueryChange: (value: string) => void;
  onRoleChange: (userId: number, role: PortalStorageSpaceGrantRole | null) => void;
  onRequestPerson?: (payload: { targetName: string; targetEmail: string }) => Promise<void>;
  onRequestDraftStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const term = query.trim().toLowerCase();
  const [request, setRequest] = useState<{ name: string; email: string } | null>(null);
  const visibleCandidates = candidates.filter((candidate) => {
    if (!includeAlreadyShared && candidate.already_shared) return false;
    if (!term) return true;
    return [candidate.email, candidate.display_name, candidate.portal_role]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
  const selectedCount = Object.keys(selectedRolesByUserId).length;
  const openRequestForm = () => {
    const value = query.trim();
    const email = /\S+@\S+\.\S+/.test(value);
    setRequest({ name: email ? "" : value, email: email ? value : "" });
  };
  const requestCta = onRequestPerson ? (
    <div className="settings-stack">
      <div className="settings-description">
        {t({
          en: "Need someone who is not listed? Ask an admin to add them to this project, then you can invite them to the space.",
          fr: "Besoin d'une personne absente de la liste ? Demandez à un admin de l'ajouter au projet, puis vous pourrez l'inviter dans l'espace.",
          de: "Fehlt eine Person in der Liste? Bitten Sie einen Admin, sie zum Projekt hinzuzufügen; danach können Sie sie in den Bereich einladen.",
        })}
      </div>
      <UiButton size="sm" variant="secondary" onClick={openRequestForm}>
        {t({ en: "Request collaborator access", fr: "Demander l'ajout d'un collaborateur", de: "Mitwirkenden-Zugriff anfragen" })}
      </UiButton>
    </div>
  ) : null;
  return (
    <div className="settings-fields">
      <ListToolbar variant="page" title={t({ en: "People selection", fr: "Sélection des personnes", de: "Personenauswahl" })}
        countLabel={t({ en: `${selectedCount} selected`, fr: `${selectedCount} sélectionné(s)`, de: `${selectedCount} ausgewählt` })}
        search={<UiInput aria-label={t({ en: "People", fr: "Personnes", de: "Personen" })}
          value={query} onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t({ en: "Search people by name or email...", fr: "Rechercher une personne par nom ou email...", de: "Personen nach Name oder E-Mail suchen..." })} />} />
      {loading ? (
        <div className="settings-description">{t({ en: "Loading people...", fr: "Chargement des personnes...", de: "Personen werden geladen..." })}</div>
      ) : error ? (
        <UiInlineMessage tone="error" role="alert">{error} {" "}{onRetry && <UiButton variant="secondary" onClick={onRetry}>{t({ en: "Retry", fr: "Réessayer", de: "Erneut versuchen" })}</UiButton>}</UiInlineMessage>
      ) : visibleCandidates.length > 0 ? (
        <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--ui-border)]">
          {visibleCandidates.map((candidate) => {
            const selectedRole = selectedRolesByUserId[candidate.user_id] ?? null;
            const existingRole = existingRolesByUserId[candidate.user_id] ?? null;
            const disabled = Boolean(candidate.already_shared);
            return (
              <div key={candidate.user_id} className="grid min-w-0 gap-3 border-b border-[var(--ui-border-soft)] px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(7rem,0.6fr)_minmax(6rem,0.5fr)]">
                <UiCheckboxField className={cx("settings-choice min-w-0", disabled && "opacity-60")}
                  checked={Boolean(selectedRole) || disabled} disabled={disabled}
                  onChange={(event) => onRoleChange(candidate.user_id, event.target.checked ? "Viewer" : null)}>
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    <span className="settings-label block">{candidate.display_name || candidate.email}</span>
                    <span className="settings-description block">{candidate.email}</span>
                  </span>
                </UiCheckboxField>
                <div className="settings-description self-center">
                  {portalAccountRoleLabel(candidate.portal_role, t)} · {portalAccessSourceLabel(candidate.access_source, t)}
                </div>
                {disabled ? (
                  <UiBadge tone="neutral">
                    {existingRole
                      ? t({
                          en: `Already invited · ${portalRoleLabel(existingRole, t)}`,
                          fr: `Déjà invité · ${portalRoleLabel(existingRole, t)}`,
                          de: `Bereits eingeladen · ${portalRoleLabel(existingRole, t)}`,
                        })
                      : t({ en: "Already invited", fr: "Déjà invité", de: "Bereits eingeladen" })}
                  </UiBadge>
                ) : (
                  <UiSelect
                    value={selectedRole ?? "Viewer"}
                    disabled={!selectedRole}
                    onChange={(event) => onRoleChange(candidate.user_id, event.target.value as PortalStorageSpaceGrantRole)}
                    aria-label={t({ en: `Access for ${candidate.email}`, fr: `Accès pour ${candidate.email}`, de: `Zugriff für ${candidate.email}` })}
                  >
                    <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                    <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                  </UiSelect>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="settings-description">
            {term
              ? t({
                  en: "No person matches this search.",
                  fr: "Aucune personne ne correspond à cette recherche.",
                  de: "Keine Person passt zu dieser Suche.",
                })
              : t({
                  en: "Only people already added to this project can be invited here.",
                  fr: "Seules les personnes déjà ajoutées à ce projet peuvent être invitées ici.",
                  de: "Nur bereits zu diesem Projekt hinzugefügte Personen können hier eingeladen werden.",
                })}
          </div>
          {requestCta}
        </div>
      )}
      {request && onRequestPerson ? (
        <PortalCollaboratorRequestDialog initialName={request.name} initialEmail={request.email}
          onSubmit={onRequestPerson} onClose={() => setRequest(null)} onDraftStateChange={onRequestDraftStateChange} />
      ) : null}
    </div>
  );
}

export function selectedPortalShares(rolesByUserId: Record<number, PortalStorageSpaceGrantRole>): PortalSelectedShare[] {
  return Object.entries(rolesByUserId)
    .map(([userId, role]) => ({ user_id: Number(userId), role }))
    .filter((entry) => Number.isFinite(entry.user_id));
}

export function PortalRoleBadge({ role }: { role: PortalStorageSpaceGrantRole }) {
  const { t } = useI18n();
  return <UiBadge tone={portalRoleTone(role)}>{portalRoleLabel(role, t)}</UiBadge>;
}
