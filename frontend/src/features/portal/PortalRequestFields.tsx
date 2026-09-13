/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import UiInput from "../../components/ui/UiInput";
import UiTextarea from "../../components/ui/UiTextarea";
import { useI18n } from "../../i18n";

export function PortalRequestReason({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  return <UiTextarea label={t({ en: "Reason (optional)", fr: "Motif (optionnel)", de: "Grund (optional)" })}
    rows={3} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />;
}

export function PortalMemberRequestFields({ name, email, reason, onNameChange, onEmailChange, onReasonChange,
  disabled, nameDisabled, emailControl,
}: {
  name: string; email: string; reason: string;
  onNameChange: (value: string) => void; onEmailChange: (value: string) => void; onReasonChange: (value: string) => void;
  disabled?: boolean; nameDisabled?: boolean; emailControl?: ReactNode;
}) {
  return <>
    <PortalMemberIdentityFields name={name} email={email} onNameChange={onNameChange} onEmailChange={onEmailChange}
      disabled={disabled} nameDisabled={nameDisabled} emailControl={emailControl} />
    <PortalRequestReason value={reason} onChange={onReasonChange} disabled={disabled} />
  </>;
}

export function PortalMemberIdentityFields({ name, email, onNameChange, onEmailChange, disabled, nameDisabled, emailControl }: {
  name: string; email: string;
  onNameChange: (value: string) => void; onEmailChange: (value: string) => void;
  disabled?: boolean; nameDisabled?: boolean; emailControl?: ReactNode;
}) {
  const { t } = useI18n();
  return <>
    <UiInput label={t({ en: "Name", fr: "Nom", de: "Name" })} value={name}
      onChange={(event) => onNameChange(event.target.value)} disabled={disabled || nameDisabled} required />
    {emailControl ?? <UiInput label={t({ en: "Email", fr: "E-mail", de: "E-Mail" })} type="email" value={email}
      onChange={(event) => onEmailChange(event.target.value)} disabled={disabled} required />}
  </>;
}
