/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useEffect, useRef, useState } from "react";
import type { PortalProjectSettings } from "../../api/portalAccounts";
import type { PortalSettingsAdminUpdate } from "../../api/appSettings";
import PageBanner from "../../components/PageBanner";
import {
  SettingsItem,
  SettingsSection,
  SettingsSwitch,
} from "../../components/settings/SettingsLayout";
import {
  SettingsActions,
  SettingsButton,
  SettingsField,
  useSettingsCloseGuard,
} from "../../components/settings/SettingsControls";
import { settingsLabels } from "../../components/settings/settingsLabels";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiBadge from "../../components/ui/UiBadge";
import UiSelect from "../../components/ui/UiSelect";
import { translate, type I18nMessage } from "../../i18n";
import {
  emptyForm,
  formFromSettings,
  mergeProjectOverrides,
  mergeDelegation,
  ProjectSettingsConflict,
  type ProjectSettingsForm,
} from "./projectSettingsForm";

type FlagField = {
  [K in keyof ProjectSettingsForm]: ProjectSettingsForm[K] extends
    | "inherit"
    | "enabled"
    | "disabled"
    ? K
    : never;
}[keyof ProjectSettingsForm];

export type ProjectSettingsAdapter = {
  load: (accountId: string) => Promise<PortalProjectSettings>;
  save: (accountId: string, payload: PortalSettingsAdminUpdate) => Promise<PortalProjectSettings>;
};

export default function ProjectSettingsEditor({
  accountId, projectName, storageName, adapter, admin = false,
  t = translate, locale = "en", onDirtyChange, navigationGuard = true,
}: {
  accountId: string;
  projectName: string;
  storageName?: string | null;
  adapter: ProjectSettingsAdapter;
  admin?: boolean;
  t?: (message: I18nMessage) => string;
  locale?: string;
  onDirtyChange?: (dirty: boolean) => void;
  navigationGuard?: boolean;
}) {
  const { draft, setDraft, baseline, accept, cancel, dirty } =
    useSettingsDraft(emptyForm);
  const [settings, setSettings] = useState<PortalProjectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<
    "load" | "save" | "conflict" | "access" | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [retentionError, setRetentionError] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [originsOpen, setOriginsOpen] = useState(false);
  const [dialogDirty, setDialogDirty] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  useEffect(() => {
    onDirtyChange?.(dirty || dialogDirty);
    return () => onDirtyChange?.(false);
  }, [dirty, dialogDirty, onDirtyChange]);
  const formRef = useRef<HTMLFormElement>(null);
  const active = useRef(true);
  const pending = useRef(false);
  const conflictLatest = useRef<PortalProjectSettings | null>(null);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    adapter.load(accountId)
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
          accept(formFromSettings(value));
        }
      })
      .catch(() => {
        if (!cancelled) setError("load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      active.current = false;
      cancelled = true;
    };
  }, [accountId, accept, adapter]);

  const labels = settingsLabels(t);
  const discard = () => {
    if (conflictLatest.current) {
      setSettings(conflictLatest.current);
      accept(formFromSettings(conflictLatest.current));
      conflictLatest.current = null;
    } else cancel();
    setError(null);
    setRetentionError(false);
    setConflicts([]);
  };
  const guard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    onClose: discard,
    title: labels.discardTitle,
    description: labels.discardDescription,
    confirmLabel: labels.discard,
    cancelLabel: labels.keepEditing,
    closeLabel: labels.close,
  });
  const editable = Boolean(settings?.can_update);
  const update = <K extends keyof ProjectSettingsForm>(
    key: K,
    value: ProjectSettingsForm[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const save = async () => {
    if (!editable || pending.current) return;
    const invalid =
      draft.versionHistoryRetentionOverride &&
      (!/^\d+$/.test(draft.versionHistoryRetentionDays) ||
        Number(draft.versionHistoryRetentionDays) < 1 ||
        !Number.isSafeInteger(Number(draft.versionHistoryRetentionDays)));
    setRetentionError(invalid);
    if (invalid) {
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const latest = await adapter.load(accountId);
      if (!active.current) return;
      conflictLatest.current = latest;
      if (!latest.can_update) {
        setSettings(latest);
        setError("access");
        return;
      }
      const payload: PortalSettingsAdminUpdate = mergeProjectOverrides(
        baseline,
        draft,
        latest.project_override,
      );
      if (admin) {
        payload.delegated_to_portal_managers = mergeDelegation(
          baseline.delegatedToPortalManagers, draft.delegatedToPortalManagers,
          latest.delegated_to_portal_managers,
        );
        // A delegation-only request preserves the override in the existing API.
        if (Object.keys(payload).length === 1) payload.bucket_defaults = null;
      }
      const next = await adapter.save(accountId, payload);
      if (!active.current) return;
      setSettings(next);
      accept(formFromSettings(next));
      conflictLatest.current = null;
      setSaved(true);
    } catch (cause) {
      if (active.current && cause instanceof ProjectSettingsConflict) setConflicts(cause.fields);
      if (active.current)
        setError(
          cause instanceof Error &&
            cause.message === "project_settings_conflict"
            ? "conflict"
            : "save",
        );
    } finally {
      pending.current = false;
      if (active.current) setSaving(false);
    }
  };
  const enabled = (value: boolean) =>
    value
      ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert" })
      : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert" });
  const source = (custom: boolean) =>
    custom
      ? t({ en: "Project", fr: "Projet", de: "Projekt" })
      : t({ en: "Platform", fr: "Plateforme", de: "Plattform" });
  const effective = (value: string) =>
    `${t({ en: "Currently applied", fr: "Actuellement appliqué", de: "Derzeit angewendet" })}: ${value}`;
  const row = (
    key: FlagField,
    title: string,
    value: boolean,
    description?: string,
  ) => (
    <SettingsItem
      key={key}
      compact
      title={title}
      description={
        <>
          {description && <>{description} </>}
          {effective(enabled(value))}
        </>
      }
      status={
        <UiBadge tone="neutral">{source(baseline[key] !== "inherit")}</UiBadge>
      }
      action={
        editable ? (
          <UiSelect
            className="settings-control"
            size="compact"
            aria-label={title}
            value={draft[key]}
            onChange={(event) =>
              update(key, event.target.value as ProjectSettingsForm[FlagField])
            }
          >
            <option value="inherit">
              {t({
                en: "Platform value",
                fr: "Valeur de la plateforme",
                de: "Plattformwert",
              })}
            </option>
            <option value="enabled">{enabled(true)}</option>
            <option value="disabled">{enabled(false)}</option>
          </UiSelect>
        ) : (
          <span className="settings-readonly">{enabled(value)}</span>
        )
      }
    />
  );
  const fieldLabels: Record<string, string> = {
    browser_access_enabled: t({ en: "Browser workspace access", fr: "Accès à l’espace Browser", de: "Browser-Arbeitsbereich" }),
    allow_private_storage_space_create: t({ en: "Private Storage Space creation", fr: "Création d’espaces privés", de: "Private Speicherbereiche erstellen" }),
    allow_portal_named_bucket_create: t({ en: "Named bucket creation", fr: "Création de buckets nommés", de: "Benannte Buckets erstellen" }),
    allow_portal_user_access_key_create: t({ en: "Personal access keys", fr: "Clés d’accès personnelles", de: "Persönliche Zugriffsschlüssel" }),
    server_access_logging_enabled: t({ en: "Server access logging", fr: "Journalisation des accès serveur", de: "Server-Zugriffsprotokollierung" }),
    storage_space_version_cleanup_enabled: t({ en: "Storage Space history cleanup", fr: "Nettoyage de l’historique", de: "Versionsverlauf bereinigen" }),
    versioning: t({ en: "Versioning", fr: "Gestion des versions", de: "Versionierung" }),
    enable_lifecycle: t({ en: "Lifecycle", fr: "Cycle de vie", de: "Lebenszyklus" }),
    enable_cors: "CORS",
    cors_allowed_origins: t({ en: "CORS origins", fr: "Origines CORS", de: "CORS-Ursprünge" }),
    noncurrent_version_expiration_days: t({ en: "Version history retention", fr: "Conservation de l’historique", de: "Aufbewahrung des Versionsverlaufs" }),
    delegated_to_portal_managers: "Delegation",
  };
  const customize = t({ en: "Customize", fr: "Personnaliser", de: "Anpassen" });
  const originsTitle = t({
    en: "CORS origins",
    fr: "Origines CORS",
    de: "CORS-Ursprünge",
  });
  const retentionTitle = t({
    en: "Version history retention",
    fr: "Conservation de l’historique",
    de: "Aufbewahrung des Versionsverlaufs",
  });
  const days =
    settings?.effective.bucket_defaults.noncurrent_version_expiration_days ?? 0;
  const daysText = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "day",
    unitDisplay: "long",
  }).format(days);
  return (
    <div className="settings-compact">
      {loading && (
        <PageBanner tone="info">
          {t({
            en: "Loading project settings...",
            fr: "Chargement des paramètres du projet...",
            de: "Projekteinstellungen werden geladen...",
          })}
        </PageBanner>
      )}
      {error && (
        <PageBanner tone="error">
          {error === "load"
            ? t({
                en: "Unable to load project settings.",
                fr: "Impossible de charger les paramètres du projet.",
                de: "Projekteinstellungen konnten nicht geladen werden.",
              })
            : error === "conflict"
              ? t({
                  en: "A setting you edited has changed on the server. Your draft is preserved. Cancel to load the current values.",
                  fr: "Un paramètre modifié a changé sur le serveur. Votre brouillon est conservé. Annulez pour charger les valeurs actuelles.",
                  de: "Eine bearbeitete Einstellung wurde auf dem Server geändert. Ihr Entwurf bleibt erhalten. Brechen Sie ab, um die aktuellen Werte zu laden.",
                })
              : error === "access"
                ? t({
                    en: "Your settings access has changed. Your draft is preserved; reload this page to review your permissions.",
                    fr: "Vos droits de modification ont changé. Votre brouillon est conservé ; rechargez la page pour consulter vos droits.",
                    de: "Ihre Bearbeitungsrechte haben sich geändert. Ihr Entwurf bleibt erhalten; laden Sie die Seite neu, um Ihre Rechte zu prüfen.",
                  })
                : t({
                    en: "Unable to save project settings. Your changes are preserved.",
                    fr: "Impossible d’enregistrer les paramètres. Vos modifications sont conservées.",
                    de: "Projekteinstellungen konnten nicht gespeichert werden. Ihre Änderungen bleiben erhalten.",
                  })}
          {error === "conflict" && conflicts.length > 0 && (
            <p>{new Intl.ListFormat(locale).format(conflicts.map((field) => fieldLabels[field] ?? field))}</p>
          )}
        </PageBanner>
      )}
      {saved && (
        <PageBanner tone="success">
          {t({
            en: "Project settings saved.",
            fr: "Paramètres du projet enregistrés.",
            de: "Projekteinstellungen gespeichert.",
          })}
        </PageBanner>
      )}
      {!admin && <SettingsSection
        presentation="compact"
        title={t({ en: "Project", fr: "Projet", de: "Projekt" })}
      >
        <SettingsItem
          compact
          title={projectName}
          description={storageName}
          status={
            <UiBadge tone={editable ? "primary" : "neutral"}>
              {editable
                ? t({
                    en: "Can edit",
                    fr: "Modification autorisée",
                    de: "Bearbeitung erlaubt",
                  })
                : t({
                    en: "Read only",
                    fr: "Lecture seule",
                    de: "Schreibgeschützt",
                  })}
            </UiBadge>
          }
        />
        {settings && (
          <p className="py-1 settings-description">
            {editable
              ? t({
                  en: "Project settings are shared with administrators. Platform values are resolved when you save.",
                  fr: "Ces paramètres sont partagés avec les administrateurs. Les valeurs de la plateforme sont résolues à l’enregistrement.",
                  de: "Diese Einstellungen werden mit Administratoren geteilt. Plattformwerte werden beim Speichern ermittelt.",
                })
              : !settings.delegated_to_portal_managers
                ? t({
                    en: "Project settings are managed by the platform administrator.",
                    fr: "Les paramètres du projet sont gérés par l’administrateur de la plateforme.",
                    de: "Projekteinstellungen werden vom Plattformadministrator verwaltet.",
                  })
                : t({
                    en: "Only delegated project managers can edit these settings.",
                    fr: "Seuls les gestionnaires délégués du projet peuvent modifier ces paramètres.",
                    de: "Nur berechtigte Projektmanager können diese Einstellungen bearbeiten.",
                  })}
          </p>
        )}
      </SettingsSection>}
      {settings && (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={saving} className="min-w-0">
            {admin && <SettingsSection presentation="compact" title="Delegation">
              <SettingsItem compact title="Project settings access"
                description="Allow this project's Portal managers to edit the same settings from Portal."
                action={<SettingsSwitch ariaLabel="Delegate Portal overrides to Portal managers"
                  checked={draft.delegatedToPortalManagers}
                  onChange={(value) => update("delegatedToPortalManagers", value)} />} />
            </SettingsSection>}
            <SettingsSection
              presentation="compact"
              title={t({
                en: "Allowed features",
                fr: "Fonctions autorisées",
                de: "Erlaubte Funktionen",
              })}
            >
              {row(
                "browserAccess",
                t({
                  en: "Browser workspace access",
                  fr: "Accès à l’espace Browser",
                  de: "Browser-Arbeitsbereich",
                }),
                settings.effective.browser_access_enabled,
              )}
              {row(
                "bucketCreate",
                t({
                  en: "Private Storage Space creation",
                  fr: "Création d’espaces privés",
                  de: "Private Speicherbereiche erstellen",
                }),
                settings.effective.allow_private_storage_space_create,
              )}
              {row(
                "namedBucketCreate",
                t({
                  en: "Named bucket creation",
                  fr: "Création de buckets nommés",
                  de: "Benannte Buckets erstellen",
                }),
                settings.effective.allow_portal_named_bucket_create,
              )}
              {row(
                "accessKeyCreate",
                t({
                  en: "Personal access keys",
                  fr: "Clés d’accès personnelles",
                  de: "Persönliche Zugriffsschlüssel",
                }),
                settings.effective.allow_portal_user_access_key_create,
              )}
              {row(
                "serverAccessLogging",
                t({
                  en: "Server access logging",
                  fr: "Journalisation des accès serveur",
                  de: "Server-Zugriffsprotokollierung",
                }),
                settings.effective.server_access_logging_enabled,
                t({
                  en: "Collects object activity for project history.",
                  fr: "Collecte l’activité des objets pour l’historique du projet.",
                  de: "Erfasst Objektaktivitäten für den Projektverlauf.",
                }),
              )}
              {row(
                "versionCleanup",
                t({
                  en: "Storage Space history cleanup",
                  fr: "Nettoyage de l’historique",
                  de: "Versionsverlauf bereinigen",
                }),
                settings.effective.storage_space_version_cleanup_enabled,
              )}
            </SettingsSection>
            <SettingsSection
              presentation="compact"
              title={t({
                en: "New Storage Space defaults",
                fr: "Valeurs des nouveaux espaces",
                de: "Standardwerte neuer Speicherbereiche",
              })}
              description={t({
                en: "Applied to new spaces only. Existing spaces keep their configuration.",
                fr: "Appliquées aux nouveaux espaces. Les espaces existants conservent leur configuration.",
                de: "Gelten nur für neue Bereiche. Bestehende Bereiche behalten ihre Konfiguration.",
              })}
            >
              {row(
                "versioning",
                t({
                  en: "Versioning",
                  fr: "Gestion des versions",
                  de: "Versionierung",
                }),
                settings.effective.bucket_defaults.versioning,
              )}
              {row(
                "lifecycle",
                t({ en: "Lifecycle", fr: "Cycle de vie", de: "Lebenszyklus" }),
                settings.effective.bucket_defaults.enable_lifecycle,
              )}
              <SettingsItem
                compact
                title={retentionTitle}
                description={effective(daysText)}
                status={
                  <UiBadge tone="neutral">
                    {source(baseline.versionHistoryRetentionOverride)}
                  </UiBadge>
                }
                action={
                  editable ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {draft.versionHistoryRetentionOverride && (
                        <SettingsField
                          label={retentionTitle}
                          unit={t({ en: "Days", fr: "Jours", de: "Tage" })}
                          type="number"
                          min={1}
                          step={1}
                          value={draft.versionHistoryRetentionDays}
                          onChange={(event) =>
                            update(
                              "versionHistoryRetentionDays",
                              event.target.value,
                            )
                          }
                          className="w-24"
                          error={
                            retentionError
                              ? t({
                                  en: "Enter a positive whole number.",
                                  fr: "Saisissez un entier positif.",
                                  de: "Geben Sie eine positive ganze Zahl ein.",
                                })
                              : undefined
                          }
                        />
                      )}
                      <span className="settings-body">{customize}</span>
                      <SettingsSwitch
                        ariaLabel={`${customize} — ${retentionTitle}`}
                        checked={draft.versionHistoryRetentionOverride}
                        onChange={(value) =>
                          update("versionHistoryRetentionOverride", value)
                        }
                      />
                    </div>
                  ) : (
                    <span className="settings-readonly">{daysText}</span>
                  )
                }
              />
              {row(
                "cors",
                "CORS",
                settings.effective.bucket_defaults.enable_cors,
              )}
              <SettingsItem
                compact
                title={originsTitle}
                description={effective(
                  new Intl.ListFormat(locale).format(
                    settings.effective.bucket_defaults.cors_allowed_origins,
                  ) || t({ en: "None", fr: "Aucune", de: "Keine" }),
                )}
                status={
                  <UiBadge tone="neutral">
                    {source(baseline.corsOriginsOverride)}
                  </UiBadge>
                }
                action={
                  editable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.corsOriginsOverride && (
                        <SettingsButton
                          variant="secondary"
                          onClick={() => setOriginsOpen(true)}
                        >
                          {t({
                            en: "Configure",
                            fr: "Configurer",
                            de: "Konfigurieren",
                          })}
                        </SettingsButton>
                      )}
                      <span className="settings-body">{customize}</span>
                      <SettingsSwitch
                        ariaLabel={`${customize} — ${originsTitle}`}
                        checked={draft.corsOriginsOverride}
                        onChange={(value) =>
                          update("corsOriginsOverride", value)
                        }
                      />
                    </div>
                  ) : undefined
                }
              />
            </SettingsSection>
            {editable && (
              <SettingsButton
                variant="ghost"
                onClick={() => setResetOpen(true)}
              >
                {t({
                  en: "Restore platform values",
                  fr: "Rétablir les valeurs de la plateforme",
                  de: "Plattformwerte wiederherstellen",
                })}
              </SettingsButton>
            )}
          </fieldset>
          <SettingsActions
            dirty={dirty}
            busy={saving}
            disabled={!editable}
            onSave={() => void save()}
            onCancel={guard.requestClose}
            saveLabel={t({
              en: "Save changes",
              fr: "Enregistrer",
              de: "Änderungen speichern",
            })}
            cancelLabel={labels.cancel}
            savingLabel={t({
              en: "Saving...",
              fr: "Enregistrement...",
              de: "Speichern...",
            })}
          />
        </form>
      )}
      {navigationGuard && <SettingsNavigationGuard
        dirty={dirty || dialogDirty}
        title={labels.discardTitle}
        description={labels.discardDescription}
        confirmLabel={labels.discard}
        cancelLabel={labels.keepEditing}
        closeLabel={labels.close}
      />}
      {guard.confirmationDialog}
      {resetOpen && (
        <ConfirmActionDialog
          title={t({
            en: "Restore platform values?",
            fr: "Rétablir les valeurs de la plateforme ?",
            de: "Plattformwerte wiederherstellen?",
          })}
          description={t({
            en: "All project customizations will be removed from your draft. Save to apply this change.",
            fr: "Toutes les personnalisations seront retirées du brouillon. Enregistrez pour appliquer ce changement.",
            de: "Alle Projektanpassungen werden aus Ihrem Entwurf entfernt. Speichern Sie, um diese Änderung anzuwenden.",
          })}
          confirmLabel={labels.apply}
          cancelLabel={labels.cancel}
          closeLabel={labels.close}
          onCancel={() => setResetOpen(false)}
          onConfirm={() => {
            setDraft({
              ...emptyForm,
              delegatedToPortalManagers: draft.delegatedToPortalManagers,
              versionHistoryRetentionDays: String(days),
              corsOriginsText:
                settings?.effective.bucket_defaults.cors_allowed_origins.join(
                  "\n",
                ) ?? "",
            });
            setResetOpen(false);
            setSaved(false);
          }}
        />
      )}
      {originsOpen && (
        <SettingsDraftDialog
          title={originsTitle}
          initialValue={draft.corsOriginsText}
          labels={labels}
          onDirtyChange={setDialogDirty}
          onApply={(value) => update("corsOriginsText", value)}
          onClose={() => setOriginsOpen(false)}
        >
          {(value, setValue) => (
            <label>
              {t({
                en: "One origin per line, or * for all origins.",
                fr: "Une origine par ligne, ou * pour toutes les origines.",
                de: "Ein Ursprung pro Zeile oder * für alle Ursprünge.",
              })}
              <textarea
                className="w-full rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] p-2"
                rows={5}
                aria-label={originsTitle}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          )}
        </SettingsDraftDialog>
      )}
    </div>
  );
}
