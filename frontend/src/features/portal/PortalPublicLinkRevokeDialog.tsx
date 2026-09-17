/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalPublicLink } from "../../api/portalSharing";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useI18n } from "../../i18n";

type PortalPublicLinkRevokeDialogProps = {
  link: PortalPublicLink;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function PortalPublicLinkRevokeDialog({
  link,
  loading,
  onCancel,
  onConfirm,
}: PortalPublicLinkRevokeDialogProps) {
  const { t } = useI18n();
  return (
    <ConfirmActionDialog
      title={t({
        en: "Revoke public link",
        fr: "Révoquer le lien public",
        de: "Öffentlichen Link widerrufen",
        zh: "撤销公开链接",
      })}
      description={t({
        en: "Confirm that you want to revoke this public link.",
        fr: "Confirmez que vous voulez révoquer ce lien public.",
        de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten.",
        zh: "确认要撤销此公开链接。",
      })}
      confirmLabel={t({
        en: "Revoke link",
        fr: "Révoquer le lien",
        de: "Link widerrufen",
        zh: "撤销链接",
      })}
      loading={loading}
      cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen", zh: "取消" })}
      closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen", zh: "关闭" })}
      processingLabel={t({ en: "Revoking...", fr: "Révocation...", de: "Wird widerrufen...", zh: "正在撤销…" })}
      impactLabel={t({ en: "Impact", fr: "Conséquences", de: "Auswirkungen", zh: "影响" })}
      details={[
        {
          label: t({ en: "File", fr: "Fichier", de: "Datei", zh: "文件" }),
          value: link.object_name,
        },
        {
          label: t({ en: "Space", fr: "Espace", de: "Bereich", zh: "空间" }),
          value: link.storage_space_name,
        },
        {
          label: t({ en: "Link", fr: "Lien", de: "Link", zh: "链接" }),
          value: link.url,
          mono: true,
        },
      ]}
      impacts={[
        t({
          en: "Anyone using this URL loses access immediately.",
          fr: "Toute personne utilisant cette URL perd immédiatement l'accès.",
          de: "Alle, die diese URL verwenden, verlieren sofort den Zugriff.",
          zh: "所有使用此 URL 的人员将立即失去访问权限。",
        }),
        t({
          en: "The file remains in the space.",
          fr: "Le fichier reste dans l'espace.",
          de: "Die Datei bleibt im Bereich.",
          zh: "文件仍保留在空间中。",
        }),
      ]}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
