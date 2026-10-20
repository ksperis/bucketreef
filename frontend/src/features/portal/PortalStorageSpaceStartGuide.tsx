/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiBadge from "../../components/ui/UiBadge";
import UiButton, { UiButtonLink } from "../../components/ui/UiButton";
import {
  cx,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";

type PortalStorageSpaceStartGuideProps = {
  objectCount: number | null | undefined;
  filesHref: string;
  canInvitePeople: boolean;
  canInviteNow: boolean;
  onDismiss: () => void;
  onInvite: () => void;
};

export default function PortalStorageSpaceStartGuide({
  objectCount,
  filesHref,
  canInvitePeople,
  canInviteNow,
  onDismiss,
  onInvite,
}: PortalStorageSpaceStartGuideProps) {
  const { t } = useI18n();

  return (
    <section className={cx(uiPanelMutedClass, "p-4")} aria-labelledby="space-start-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="space-start-title" className={cx("text-[15px] font-bold", uiTitleTextClass)}>
            {t({ en: "Start this space", fr: "Démarrer cet espace", de: "Diesen Bereich starten", zh: "开始使用此空间" })}
          </h2>
          <p className={cx("mt-1 max-w-3xl text-xs leading-5", uiMutedTextClass)}>
            {t({
              en: "Keep the first steps focused: add the files people need, then invite collaborators when the space is ready.",
              fr: "Gardez les premières étapes simples : ajoutez les fichiers utiles, puis invitez les collaborateurs quand l'espace est prêt.",
              de: "Halten Sie die ersten Schritte fokussiert: Fügen Sie die benötigten Dateien hinzu und laden Sie danach Mitwirkende ein.",
              zh: "先添加大家需要的文件，再在空间准备就绪后邀请协作者。",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {objectCount === 0 ? (
            <UiBadge tone="warning">{t({ en: "No files yet", fr: "Aucun fichier", de: "Noch keine Dateien", zh: "暂无文件" })}</UiBadge>
          ) : null}
          <UiButton size="xs" variant="secondary" onClick={onDismiss}>
            {t({ en: "Dismiss guide", fr: "Masquer le guide", de: "Anleitung ausblenden", zh: "关闭指引" })}
          </UiButton>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-2">
        <li className="flex min-h-[112px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div>
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Step 1", fr: "Étape 1", de: "Schritt 1", zh: "第 1 步" })}
            </div>
            <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
              {t({ en: "Add files or folders", fr: "Ajouter des fichiers ou dossiers", de: "Dateien oder Ordner hinzufügen", zh: "添加文件或文件夹" })}
            </h3>
            <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
              {t({
                en: "Use the file area below as the working place for this project or dataset.",
                fr: "Utilisez la zone de fichiers ci-dessous comme espace de travail du projet ou du jeu de données.",
                de: "Nutzen Sie den Dateibereich unten als Arbeitsbereich für dieses Projekt oder diesen Datensatz.",
                zh: "使用下方文件区域存放此项目或数据集的内容。",
              })}
            </p>
          </div>
          <div className="mt-3">
            <UiButtonLink to={filesHref} size="sm">
              {t({ en: "Add files", fr: "Ajouter des fichiers", de: "Dateien hinzufügen", zh: "添加文件" })}
            </UiButtonLink>
          </div>
        </li>
        <li className="flex min-h-[112px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div>
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Step 2", fr: "Étape 2", de: "Schritt 2", zh: "第 2 步" })}
            </div>
            <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
              {t({ en: "Invite collaborators", fr: "Inviter des collaborateurs", de: "Mitwirkende einladen", zh: "邀请协作者" })}
            </h3>
            <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
              {canInvitePeople
                ? t({
                    en: "Bring people in once the file structure is ready for them.",
                    fr: "Invitez les personnes concernées lorsque l'organisation des fichiers est prête.",
                    de: "Laden Sie Personen ein, sobald die Dateistruktur für sie bereit ist.",
                    zh: "文件结构准备就绪后，再邀请大家加入。",
                  })
                : t({
                    en: "This space is private for now. Access can be opened from the Collaborators section when allowed.",
                    fr: "Cet espace est privé pour l'instant. L'accès pourra être ouvert depuis la section Collaborateurs si vous y êtes autorisé.",
                    de: "Dieser Bereich ist vorerst privat. Der Zugriff kann bei entsprechender Berechtigung im Bereich Mitwirkende geöffnet werden.",
                    zh: "此空间目前为私有。在允许的情况下，可从“协作者”部分开放访问。",
                  })}
            </p>
          </div>
          <div className="mt-3">
            {canInviteNow ? (
              <UiButton size="sm" variant="secondary" onClick={onInvite}>
                {t({ en: "Invite people", fr: "Inviter", de: "Einladen", zh: "邀请人员" })}
              </UiButton>
            ) : (
              <span className={cx("text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "Private for now", fr: "Privé pour l'instant", de: "Vorerst privat", zh: "目前为私有" })}
              </span>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
