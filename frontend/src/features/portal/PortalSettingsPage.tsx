/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState } from "react";
import {
  fetchPortalProjectSettings,
  updatePortalProjectSettings,
  type PortalProjectSettings,
} from "../../api/portalAccounts";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import {
  SettingsItem,
  SettingsSection,
  SettingsSwitch,
} from "../../components/settings/SettingsLayout";
import {
  SettingsActions,
  SettingsButton,
  SettingsConfirmation,
  SettingsField,
  useSettingsCloseGuard,
} from "../../components/settings/SettingsControls";
import SettingsDraftDialog from "../../components/settings/SettingsDraftDialog";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { useSettingsDraft } from "../../components/settings/useSettingsDraft";
import UiBadge from "../../components/ui/UiBadge";
import UiSelect from "../../components/ui/UiSelect";
import { useI18n } from "../../i18n";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import {
  emptyForm,
  formFromSettings,
  mergeProjectOverrides,
  type ProjectSettingsForm,
} from "./portalSettingsForm";

type FlagField = {
  [K in keyof ProjectSettingsForm]: ProjectSettingsForm[K] extends
    | "inherit"
    | "enabled"
    | "disabled"
    ? K
    : never;
}[keyof ProjectSettingsForm];

function ProjectSettings({
  accountId,
  projectName,
  storageName,
}: {
  accountId: string;
  projectName: string;
  storageName?: string | null;
}) {
  const { t, locale } = useI18n();
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
  const active = useRef(true);
  const pending = useRef(false);
  const conflictLatest = useRef<PortalProjectSettings | null>(null);
  useEffect(() => {
    active.current = true;
    fetchPortalProjectSettings(accountId)
      .then((value) => {
        if (active.current) {
          setSettings(value);
          accept(formFromSettings(value));
        }
      })
      .catch(() => {
        if (active.current) setError("load");
      })
      .finally(() => {
        if (active.current) setLoading(false);
      });
    return () => {
      active.current = false;
    };
  }, [accountId, accept]);

  const labels = {
    apply: t({ en: "Apply", fr: "Appliquer", de: "Übernehmen" }),
    cancel: t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" }),
    close: t({ en: "Close", fr: "Fermer", de: "Schließen" }),
    discardTitle: t({
      en: "Discard changes?",
      fr: "Abandonner les modifications ?",
      de: "Änderungen verwerfen?",
    }),
    discardDescription: t({
      en: "Your changes have not been saved.",
      fr: "Vos modifications n’ont pas été enregistrées.",
      de: "Ihre Änderungen wurden noch nicht gespeichert.",
    }),
    discard: t({
      en: "Discard changes",
      fr: "Abandonner",
      de: "Änderungen verwerfen",
    }),
    keepEditing: t({
      en: "Keep editing",
      fr: "Continuer la modification",
      de: "Weiter bearbeiten",
    }),
  };
  const discard = () => {
    if (conflictLatest.current) {
      setSettings(conflictLatest.current);
      accept(formFromSettings(conflictLatest.current));
      conflictLatest.current = null;
    } else cancel();
    setError(null);
    setRetentionError(false);
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
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const latest = await fetchPortalProjectSettings(accountId);
      if (!active.current) return;
      if (!latest.can_update) {
        setError("access");
        return;
      }
      conflictLatest.current = latest;
      const payload = mergeProjectOverrides(
        baseline,
        draft,
        latest.project_override,
      );
      const next = await updatePortalProjectSettings(accountId, payload);
      if (!active.current) return;
      setSettings(next);
      accept(formFromSettings(next));
      conflictLatest.current = null;
      setSaved(true);
    } catch (cause) {
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
      <SettingsSection
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
          <p className="py-2 text-[13px] text-[var(--ui-text-muted)]">
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
      </SettingsSection>
      {settings && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={saving} className="min-w-0">
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
                      <span className="text-sm">{customize}</span>
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
                      <span className="text-sm">{customize}</span>
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
      <SettingsNavigationGuard
        dirty={dirty || dialogDirty}
        title={labels.discardTitle}
        description={labels.discardDescription}
        confirmLabel={labels.discard}
        cancelLabel={labels.keepEditing}
        closeLabel={labels.close}
      />
      {guard.confirmationDialog}
      {resetOpen && (
        <SettingsConfirmation
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

export default function PortalSettingsPage() {
  const { t } = useI18n();
  const { selectedAccount, selectedAccountId, loading, error } =
    usePortalAccountContext();
  const title = t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" });
  return (
    <PageShell
      title={title}
      description={t({
        en: "Manage project capabilities and defaults.",
        fr: "Gérez les fonctions et valeurs par défaut du projet.",
        de: "Verwalten Sie Projektfunktionen und Standardwerte.",
      })}
      breadcrumbs={portalBreadcrumbs({ label: title })}
      breadcrumbLabel={t({
        en: "Breadcrumb",
        fr: "Fil d’Ariane",
        de: "Brotkrumennavigation",
      })}
    >
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {selectedAccountId ? (
        <ProjectSettings
          key={selectedAccountId}
          accountId={selectedAccountId}
          projectName={selectedAccount?.name ?? selectedAccountId}
          storageName={
            selectedAccount?.storage_endpoint_name ??
            selectedAccount?.storage_endpoint_url
          }
        />
      ) : (
        <PageBanner tone="info">
          {loading
            ? t({
                en: "Loading projects...",
                fr: "Chargement des projets...",
                de: "Projekte werden geladen...",
              })
            : t({
                en: "Select a project to view its settings.",
                fr: "Sélectionnez un projet pour consulter ses paramètres.",
                de: "Wählen Sie ein Projekt, um seine Einstellungen anzuzeigen.",
              })}
        </PageBanner>
      )}
    </PageShell>
  );
}
