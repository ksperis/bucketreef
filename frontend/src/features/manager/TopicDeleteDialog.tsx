/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState } from "react";
import { deleteTopic, type Topic } from "../../api/topics";
import type { S3AccountSelector } from "../../api/accountParams";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import SettingsNavigationGuard from "../../components/settings/SettingsNavigationGuard";
import { extractApiError } from "../../utils/apiError";
import { useManagerI18n } from "./managerI18n";

export default function TopicDeleteDialog({ accountId, currentAccountId, topic, onDeleted, onClose }: {
  accountId: S3AccountSelector;
  currentAccountId: S3AccountSelector;
  topic: Topic;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { text } = useManagerI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (currentAccountId !== accountId && !busy) onClose();
  }, [accountId, currentAccountId, busy, onClose]);
  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try { await deleteTopic(accountId, topic.arn); onDeleted(); }
    catch (error) { setError(extractApiError(error, text("Unable to delete topic."))); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <><ConfirmActionDialog title={text("Delete notification topic?")}
    description={text("Permanently remove this SNS topic from the selected account.")}
    confirmLabel={text("Delete topic")} loading={busy} error={error}
    details={[{ label: text("Topic"), value: topic.name }, { label: text("ARN"), value: topic.arn, mono: true }]}
    impacts={["Bucket notifications targeting this topic will no longer be delivered."]}
    onCancel={() => { if (!submitting.current) onClose(); }} onConfirm={() => void confirm()} />
    <SettingsNavigationGuard dirty={busy} discardDisabled title={text("Operation in progress")}
      description={text("Wait for the topic deletion to finish before leaving this page.")} />
  </>;
}
