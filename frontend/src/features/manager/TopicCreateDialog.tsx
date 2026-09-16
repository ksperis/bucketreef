/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useState } from "react";
import { createTopic } from "../../api/topics";
import type { S3AccountSelector } from "../../api/accountParams";
import SettingsFormDialog from "../../components/settings/SettingsFormDialog";
import UiInput from "../../components/ui/UiInput";
import { extractApiError } from "../../utils/apiError";

export default function TopicCreateDialog({ accountId, currentAccountId, onCreated, onClose }: {
  accountId: S3AccountSelector;
  currentAccountId: S3AccountSelector;
  onCreated: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (currentAccountId !== accountId && !name) onClose();
  }, [accountId, currentAccountId, name, onClose]);
  return <SettingsFormDialog title="Create SNS topic" draftKey={name} onClose={onClose}
    error={error} submitLabel="Create topic" onSubmit={async () => {
      const trimmedName = name.trim();
      if (!trimmedName) { setNameError("Topic name is required."); return; }
      setNameError(null);
      setError(null);
      try {
        await createTopic(accountId, { name: trimmedName });
        onCreated(trimmedName);
      } catch (error) {
        setError(extractApiError(error, "Unable to create topic."));
      }
    }}>
    <UiInput label="Topic name" value={name} placeholder="events-topic" error={nameError}
      onChange={event => { setName(event.target.value); setNameError(null); }} />
  </SettingsFormDialog>;
}
