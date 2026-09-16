/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { S3AccountSelector } from "../../api/accountParams";
import type { PortalStorageSpaceGrantRole } from "../../api/portal";
import { grantPortalStorageSpaceShare, listPortalStorageSpaceShareCandidates, type PortalStorageSpaceShareCandidate } from "../../api/portalSharing";
import { createPortalRequest } from "../../api/portalRequests";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { PortalShareCandidatePicker, selectedPortalShares } from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";

/** Mount for one project and space; invitation and membership requests stay separate. */
export default function PortalAddPeopleWorkflow({ accountId, spaceId, spaceName, existingRoles, disabled, onClose, onAdded }: {
  accountId: S3AccountSelector; spaceId: string; spaceName: string;
  existingRoles: Record<number, PortalStorageSpaceGrantRole>;
  disabled: boolean;
  onClose: () => void;
  onAdded: (count: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<PortalStorageSpaceShareCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<Record<number, PortalStorageSpaceGrantRole>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestDraft, setRequestDraft] = useState({ dirty: false, busy: false });
  const selected = selectedPortalShares(roles);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void listPortalStorageSpaceShareCandidates(accountId, spaceId).then(value => {
      if (active) setCandidates(value);
    }).catch(cause => {
      if (active) setLoadError(extractApiError(cause, t({ en: "Unable to load people.", fr: "Impossible de charger les personnes.", de: "Personen können nicht geladen werden.", zh: "无法加载人员。" })));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, spaceId, revision, t]);
  return <SettingsWorkflowForm
    title={t({ en: "Add people", fr: "Ajouter des personnes", de: "Personen hinzufügen", zh: "添加人员" })}
    description={t({
      en: "Choose collaborators and assign the role they need for this space.",
      fr: "Choisissez les collaborateurs et attribuez-leur le rôle nécessaire pour cet espace.",
      de: "Wählen Sie Mitwirkende aus und vergeben Sie die passende Rolle für diesen Bereich.",
      zh: "选择协作者，并为其分配在此空间中所需的角色。",
    })}
    breadcrumbs={portalBreadcrumbs(
      { label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche", zh: "空间" }), to: "/portal/storage-spaces" },
      { label: spaceName }, { label: t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen", zh: "添加人员" }) },
    )}
    backLabel={t({ en: "Back to the space", fr: "Retour à l'espace", de: "Zurück zum Bereich", zh: "返回空间" })}
    contentVariant="plain" dirty={selected.length > 0 || requestDraft.dirty} busy={requestDraft.busy}
    disabled={disabled || loading || Boolean(loadError) || selected.length === 0} error={error}
    onClose={onClose} submitLabel={t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen", zh: "添加人员" })}
    busyLabel={t({ en: "Adding...", fr: "Ajout...", de: "Wird hinzugefügt...", zh: "正在添加…" })}
    onSubmit={async () => {
      setError(null);
      try {
        await Promise.all(selected.map(entry => grantPortalStorageSpaceShare(accountId, spaceId, entry)));
        await onAdded(selected.length);
      } catch (cause) {
        setError(extractApiError(cause, t({ en: "Unable to add people.", fr: "Impossible d'ajouter ces personnes.", de: "Personen können nicht hinzugefügt werden.", zh: "无法添加人员。" })));
      }
    }}>
    {requestMessage && <UiInlineMessage tone="success" role="status">{requestMessage} {" "}
      <Link to="/portal/requests" className="text-primary hover:underline">{t({ en: "Open Help requests", fr: "Ouvrir les demandes d'aide", de: "Hilfeanfragen öffnen", zh: "打开帮助请求" })}</Link>
    </UiInlineMessage>}
    <SettingsSection presentation="compact" title={t({ en: "People", fr: "Personnes", de: "Personen", zh: "人员" })}
      description={t({
        en: "Viewer: browse and download. Editor: also upload, create folders and remove files.",
        fr: "Lecteur : consulter et télécharger. Éditeur : aussi ajouter des fichiers, créer des dossiers et supprimer des fichiers.",
        de: "Betrachter: ansehen und herunterladen. Bearbeiter: auch hochladen, Ordner erstellen und Dateien entfernen.",
        zh: "查看者：浏览和下载。编辑者：还可上传、创建文件夹和删除文件。",
      })}>
      <PortalShareCandidatePicker candidates={candidates} selectedRolesByUserId={roles} existingRolesByUserId={existingRoles}
        query={query} loading={loading} error={loadError} includeAlreadyShared onQueryChange={setQuery}
        onRetry={() => setRevision(value => value + 1)} onRequestDraftStateChange={setRequestDraft}
        onRoleChange={(userId, role) => setRoles(current => {
          const next = { ...current };
          if (role) next[userId] = role; else delete next[userId];
          return next;
        })}
        onRequestPerson={async ({ targetName, targetEmail }) => {
          await createPortalRequest(accountId, { request_type: "portal_user_access", target_name: targetName, target_email: targetEmail });
          setRequestMessage(t({
            en: `Request sent. Track it in Help requests, then return to ${spaceName} to finish the invitation.`,
            fr: `Demande envoyée. Suivez-la dans Demandes d'aide, puis revenez dans ${spaceName} pour terminer l'invitation.`,
            de: `Anfrage gesendet. Verfolgen Sie sie unter Hilfeanfragen und kehren Sie danach zu ${spaceName} zurück, um die Einladung abzuschließen.`,
            zh: `请求已发送。请在帮助请求中跟踪进度，然后返回 ${spaceName} 完成邀请。`,
          }));
        }} />
    </SettingsSection>
  </SettingsWorkflowForm>;
}
