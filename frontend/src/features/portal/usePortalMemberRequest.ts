/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  createPortalRequest,
  type PortalRequestedRole,
} from "../../api/portalRequests";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";

type UsePortalMemberRequestOptions = {
  accountId: S3AccountSelector;
  canRequestMemberChanges: boolean;
  onMembersChanged: () => void;
  onMessage: (message: string | null) => void;
  onPageError: (message: string | null) => void;
};

export function usePortalMemberRequest({
  accountId,
  canRequestMemberChanges,
  onMembersChanged,
  onMessage,
  onPageError,
}: UsePortalMemberRequestOptions) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PortalRequestedRole>("portal_user");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetDraft = useCallback(() => {
    setName("");
    setEmail("");
    setRole("portal_user");
    setReason("");
    setError(null);
  }, []);

  const openDialog = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setOpen(false);
    resetDraft();
  }, [busy, resetDraft]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const targetName = name.trim();
      const targetEmail = email.trim();
      if (
        !accountId ||
        !canRequestMemberChanges ||
        !targetName ||
        !targetEmail
      ) {
        return;
      }

      setBusy(true);
      setError(null);
      onPageError(null);
      onMessage(null);
      try {
        const request = await createPortalRequest(accountId, {
          request_type: "portal_user_access",
          intent: "add",
          target_name: targetName,
          target_email: targetEmail,
          portal_role: role,
          reason: reason.trim() || null,
        });
        setOpen(false);
        resetDraft();
        if (request.status === "approved") {
          onMembersChanged();
        }
        onMessage(
          request.status === "approved"
            ? t({
                en: "Member added to the project immediately.",
                fr: "Le membre a été ajouté immédiatement au projet.",
                de: "Das Mitglied wurde sofort zum Projekt hinzugefügt.",
                zh: "成员已立即添加到项目。",
              })
            : t({
                en: "Member request sent. Track it in Help requests.",
                fr: "Demande d'ajout envoyée. Suivez-la dans la page Demandes.",
                de: "Mitgliedsanfrage gesendet. Verfolgen Sie sie unter Hilfeanfragen.",
                zh: "成员请求已发送。可在“帮助请求”中查看进度。",
              }),
        );
      } catch (err) {
        console.error(err);
        setError(
          extractApiError(
            err,
            t({
              en: "Unable to send the member request.",
              fr: "Impossible d'envoyer la demande d'ajout.",
              de: "Mitgliedsanfrage kann nicht gesendet werden.",
              zh: "无法发送成员请求。",
            }),
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [
      accountId,
      canRequestMemberChanges,
      email,
      name,
      onMembersChanged,
      onMessage,
      onPageError,
      reason,
      resetDraft,
      role,
      t,
    ],
  );

  return {
    open,
    name,
    email,
    role,
    reason,
    error,
    busy,
    setName,
    setEmail,
    setRole,
    setReason,
    openDialog,
    closeDialog,
    submit,
  };
}
