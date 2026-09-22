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
  t = translate, locale = "en", onDirtyChange, onBusyChange, disabled = false, navigationGuard = true,
}: {
  accountId: string;
  projectName: string;
  storageName?: string | null;
  adapter: ProjectSettingsAdapter;
  admin?: boolean;
  t?: (message: I18nMessage) => string;
  locale?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  navigationGuard?: boolean;
}) {
  const { draft, setDraft, baseline, accept, cancel, dirty } =
    useSettingsDraft(emptyForm);
  const [settings, setSettings] = useState<PortalProjectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    onBusyChange?.(saving);
    return () => onBusyChange?.(false);
  }, [saving, onBusyChange]);
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
    disabled: saving || disabled,
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
    if (!editable || disabled || pending.current) return;
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
      ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert", zh: "已启用" })
      : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert", zh: "已禁用" });
  const source = (custom: boolean) =>
    custom
      ? t({ en: "Project", fr: "Projet", de: "Projekt", zh: "项目" })
      : t({ en: "Platform", fr: "Plateforme", de: "Plattform", zh: "平台" });
  const effective = (value: string) =>
    `${t({ en: "Currently applied", fr: "Actuellement appliqué", de: "Derzeit angewendet", zh: "当前生效" })}: ${value}`;
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
                zh: "平台值",
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
    browser_access_enabled: t({ en: "Browser workspace access", fr: "Accès à l’espace Browser", de: "Browser-Arbeitsbereich", zh: "对象浏览工作区访问" }),
    allow_private_storage_space_create: t({ en: "Private Storage Space creation", fr: "Création d’espaces privés", de: "Private Speicherbereiche erstellen", zh: "创建私有存储空间" }),
    allow_portal_named_bucket_create: t({ en: "Named bucket creation", fr: "Création de buckets nommés", de: "Benannte Buckets erstellen", zh: "创建指定名称的存储桶" }),
    allow_portal_user_access_key_create: t({ en: "Personal access keys", fr: "Clés d’accès personnelles", de: "Persönliche Zugriffsschlüssel", zh: "个人访问密钥" }),
    allow_portal_user_external_sharing: t({ en: "External sharing by Portal users", fr: "Partage externe par les utilisateurs Portal", de: "Externe Freigabe durch Portal-Benutzer", zh: "Portal 用户外部共享" }),
    server_access_logging_enabled: t({ en: "Server access logging", fr: "Journalisation des accès serveur", de: "Server-Zugriffsprotokollierung", zh: "服务器访问日志" }),
    storage_space_version_cleanup_enabled: t({ en: "Storage Space history cleanup", fr: "Nettoyage de l’historique", de: "Versionsverlauf bereinigen", zh: "存储空间历史记录清理" }),
    versioning: t({ en: "Versioning", fr: "Gestion des versions", de: "Versionierung", zh: "版本控制" }),
    enable_lifecycle: t({ en: "Lifecycle", fr: "Cycle de vie", de: "Lebenszyklus", zh: "生命周期" }),
    enable_cors: "CORS",
    cors_allowed_origins: t({ en: "CORS origins", fr: "Origines CORS", de: "CORS-Ursprünge", zh: "CORS 来源" }),
    noncurrent_version_expiration_days: t({ en: "Version history retention", fr: "Conservation de l’historique", de: "Aufbewahrung des Versionsverlaufs", zh: "版本历史保留期限" }),
    delegated_to_portal_managers: "Delegation",
  };
  const customize = t({ en: "Customize", fr: "Personnaliser", de: "Anpassen", zh: "自定义" });
  const originsTitle = t({
    en: "CORS origins",
    fr: "Origines CORS",
    de: "CORS-Ursprünge",
    zh: "CORS 来源",
  });
  const retentionTitle = t({
    en: "Version history retention",
    fr: "Conservation de l’historique",
    de: "Aufbewahrung des Versionsverlaufs",
    zh: "版本历史保留期限",
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
            zh: "正在加载项目设置…",
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
                zh: "无法加载项目设置。",
              })
            : error === "conflict"
              ? t({
                  en: "A setting you edited has changed on the server. Your draft is preserved. Cancel to load the current values.",
                  fr: "Un paramètre modifié a changé sur le serveur. Votre brouillon est conservé. Annulez pour charger les valeurs actuelles.",
                  de: "Eine bearbeitete Einstellung wurde auf dem Server geändert. Ihr Entwurf bleibt erhalten. Brechen Sie ab, um die aktuellen Werte zu laden.",
                  zh: "你编辑的一项设置已在服务器上变更。草稿已保留。取消编辑以加载当前值。",
                })
              : error === "access"
                ? t({
                    en: "Your settings access has changed. Your draft is preserved; reload this page to review your permissions.",
                    fr: "Vos droits de modification ont changé. Votre brouillon est conservé ; rechargez la page pour consulter vos droits.",
                    de: "Ihre Bearbeitungsrechte haben sich geändert. Ihr Entwurf bleibt erhalten; laden Sie die Seite neu, um Ihre Rechte zu prüfen.",
                    zh: "你的设置访问权限已变更。草稿已保留；请重新加载此页面以检查权限。",
                  })
                : t({
                    en: "Unable to save project settings. Your changes are preserved.",
                    fr: "Impossible d’enregistrer les paramètres. Vos modifications sont conservées.",
                    de: "Projekteinstellungen konnten nicht gespeichert werden. Ihre Änderungen bleiben erhalten.",
                    zh: "无法保存项目设置。你的更改已保留。",
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
            zh: "项目设置已保存。",
          })}
        </PageBanner>
      )}
      {!admin && <SettingsSection
        presentation="compact"
        title={t({ en: "Project", fr: "Projet", de: "Projekt", zh: "项目" })}
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
                    zh: "可编辑",
                  })
                : t({
                    en: "Read only",
                    fr: "Lecture seule",
                    de: "Schreibgeschützt",
                    zh: "只读",
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
                  zh: "项目设置与管理员共享。保存时会解析平台值。",
                })
              : !settings.delegated_to_portal_managers
                ? t({
                    en: "Project settings are managed by the platform administrator.",
                    fr: "Les paramètres du projet sont gérés par l’administrateur de la plateforme.",
                    de: "Projekteinstellungen werden vom Plattformadministrator verwaltet.",
                    zh: "项目设置由平台管理员管理。",
                  })
                : t({
                    en: "Only delegated project managers can edit these settings.",
                    fr: "Seuls les gestionnaires délégués du projet peuvent modifier ces paramètres.",
                    de: "Nur berechtigte Projektmanager können diese Einstellungen bearbeiten.",
                    zh: "只有获得委派权限的项目管理员才能编辑这些设置。",
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
          <fieldset disabled={saving || disabled} className="min-w-0">
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
                zh: "允许的功能",
              })}
            >
              {row(
                "browserAccess",
                t({
                  en: "Browser workspace access",
                  fr: "Accès à l’espace Browser",
                  de: "Browser-Arbeitsbereich",
                  zh: "对象浏览工作区访问",
                }),
                settings.effective.browser_access_enabled,
              )}
              {row(
                "bucketCreate",
                t({
                  en: "Private Storage Space creation",
                  fr: "Création d’espaces privés",
                  de: "Private Speicherbereiche erstellen",
                  zh: "创建私有存储空间",
                }),
                settings.effective.allow_private_storage_space_create,
              )}
              {row(
                "namedBucketCreate",
                t({
                  en: "Named bucket creation",
                  fr: "Création de buckets nommés",
                  de: "Benannte Buckets erstellen",
                  zh: "创建指定名称的存储桶",
                }),
                settings.effective.allow_portal_named_bucket_create,
              )}
              {row(
                "accessKeyCreate",
                t({
                  en: "Personal access keys",
                  fr: "Clés d’accès personnelles",
                  de: "Persönliche Zugriffsschlüssel",
                  zh: "个人访问密钥",
                }),
                settings.effective.allow_portal_user_access_key_create,
              )}
              {row(
                "externalSharing",
                t({
                  en: "External sharing by Portal users",
                  fr: "Partage externe par les utilisateurs Portal",
                  de: "Externe Freigabe durch Portal-Benutzer",
                  zh: "Portal 用户外部共享",
                }),
                settings.effective.allow_portal_user_external_sharing,
                t({
                  en: "Allows Portal users to create public links and external S3 tool access only for Storage Spaces they own.",
                  fr: "Autorise les utilisateurs Portal à créer des liens publics et des accès S3 externes uniquement pour les Storage Spaces dont ils sont propriétaires.",
                  de: "Erlaubt Portal-Benutzern öffentliche Links und externen S3-Werkzeugzugriff nur für eigene Storage Spaces.",
                  zh: "允许 Portal 用户仅为自己拥有的 Storage Space 创建公开链接和外部 S3 工具访问。",
                }),
              )}
              {row(
                "serverAccessLogging",
                t({
                  en: "Server access logging",
                  fr: "Journalisation des accès serveur",
                  de: "Server-Zugriffsprotokollierung",
                  zh: "服务器访问日志",
                }),
                settings.effective.server_access_logging_enabled,
                t({
                  en: "Collects object activity for project history.",
                  fr: "Collecte l’activité des objets pour l’historique du projet.",
                  de: "Erfasst Objektaktivitäten für den Projektverlauf.",
                  zh: "采集对象活动，用于项目历史记录。",
                }),
              )}
              {row(
                "versionCleanup",
                t({
                  en: "Storage Space history cleanup",
                  fr: "Nettoyage de l’historique",
                  de: "Versionsverlauf bereinigen",
                  zh: "存储空间历史记录清理",
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
                zh: "新存储空间默认设置",
              })}
              description={t({
                en: "Applied to new spaces only. Existing spaces keep their configuration.",
                fr: "Appliquées aux nouveaux espaces. Les espaces existants conservent leur configuration.",
                de: "Gelten nur für neue Bereiche. Bestehende Bereiche behalten ihre Konfiguration.",
                zh: "仅应用于新空间。现有空间保留其配置。",
              })}
            >
              {row(
                "versioning",
                t({
                  en: "Versioning",
                  fr: "Gestion des versions",
                  de: "Versionierung",
                  zh: "版本控制",
                }),
                settings.effective.bucket_defaults.versioning,
              )}
              {row(
                "lifecycle",
                t({ en: "Lifecycle", fr: "Cycle de vie", de: "Lebenszyklus", zh: "生命周期" }),
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
                          unit={t({ en: "Days", fr: "Jours", de: "Tage", zh: "天" })}
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
                                  zh: "请输入正整数。",
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
                  ) || t({ en: "None", fr: "Aucune", de: "Keine", zh: "无" }),
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
                            zh: "配置",
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
                  zh: "恢复平台值",
                })}
              </SettingsButton>
            )}
          </fieldset>
          <SettingsActions
            dirty={dirty}
            busy={saving || disabled}
            disabled={!editable}
            onSave={() => void save()}
            onCancel={guard.requestClose}
            saveLabel={t({
              en: "Save changes",
              fr: "Enregistrer",
              de: "Änderungen speichern",
              zh: "保存更改",
            })}
            cancelLabel={labels.cancel}
            savingLabel={t({
              en: "Saving...",
              fr: "Enregistrement...",
              de: "Speichern...",
              zh: "正在保存…",
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
            zh: "恢复平台值？",
          })}
          description={t({
            en: "All project customizations will be removed from your draft. Save to apply this change.",
            fr: "Toutes les personnalisations seront retirées du brouillon. Enregistrez pour appliquer ce changement.",
            de: "Alle Projektanpassungen werden aus Ihrem Entwurf entfernt. Speichern Sie, um diese Änderung anzuwenden.",
            zh: "所有项目自定义设置都将从草稿中移除。保存后生效。",
          })}
          confirmLabel={labels.apply}
          loading={saving || disabled}
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
          disabled={saving || disabled}
          onApply={(value) => update("corsOriginsText", value)}
          onClose={() => setOriginsOpen(false)}
        >
          {(value, setValue) => (
            <label>
              {t({
                en: "One origin per line, or * for all origins.",
                fr: "Une origine par ligne, ou * pour toutes les origines.",
                de: "Ein Ursprung pro Zeile oder * für alle Ursprünge.",
                zh: "每行一个来源，或使用 * 表示所有来源。",
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
