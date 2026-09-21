/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { OnboardingCheck, OnboardingJourney } from "../../api/onboarding";
import { WorkflowActions, WorkflowSection } from "../../components/WorkflowPage";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiTextarea from "../../components/ui/UiTextarea";
import { uiButtonBaseClass, uiButtonVariants, uiCheckboxClass, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { onboardingChecks, onboardingCopy as copy } from "./onboardingCopy";

export default function OnboardingValidation({ journey, actorId, busy, onConfigureSpace, onVerify, onAttest }: {
  journey: OnboardingJourney;
  actorId: number;
  busy: boolean;
  onConfigureSpace: () => void;
  onVerify: () => void;
  onAttest: (check: OnboardingCheck, checked: boolean, note: string) => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [readinessNote, setReadinessNote] = useState("");
  const self = !journey.draft.beneficiary_user_id || journey.draft.beneficiary_user_id === actorId;
  const needsSpace = journey.draft.workspace === "portal" && !journey.draft.space_id;
  const checks = (Object.keys(onboardingChecks) as Exclude<OnboardingCheck, "usage">[])
    .filter((check) => journey.draft.intent === "organization" || ["backup", "restore", "updates"].includes(check));
  return <>
    <WorkflowSection title={t(copy.validation)} description={t(copy.verifyHelp)}>
      <div className="flex flex-wrap gap-2" role="status">
        <UiBadge tone={journey.configured ? "success" : "warning"}>{t(journey.configured ? copy.configured : copy.setup)}</UiBadge>
        <UiBadge tone={journey.usage_validated ? "success" : "neutral"}>{t(journey.usage_validated ? copy.verified : copy.unverified)}</UiBadge>
        {journey.ready && <UiBadge tone="success">{t(copy.ready)}</UiBadge>}
      </div>
      {!self && <p className={uiMutedTextClass}>{t(copy.pilot)}</p>}
      {self && needsSpace && <p className={uiMutedTextClass}>{t(copy.spaceBeforeCheck)}</p>}
      <WorkflowActions>
        {self && (needsSpace
          ? <UiButton onClick={onConfigureSpace} disabled={busy}>{t(copy.chooseSpace)}</UiButton>
          : <UiButton variant={journey.usage_validated ? "secondary" : "primary"} onClick={onVerify} disabled={busy || !journey.configured}>{t(copy.verify)}</UiButton>)}
        {journey.open_url && (self
          ? <Link className={`${uiButtonBaseClass} ${uiButtonVariants[journey.usage_validated ? "primary" : "secondary"]} px-4 py-2 ui-body`} to={journey.open_url}>{t(copy.open)}</Link>
          : <UiTextarea label={t(copy.pilotLink)} readOnly value={`${window.location.origin}${journey.open_url}`} rows={2} />)}
      </WorkflowActions>
      {journey.evidence.at && <details>
        <summary className="cursor-pointer ui-body">{t(copy.technicalDetails)}</summary>
        <p className="mt-2 break-words ui-caption">{t(journey.evidence.source === "automatic" ? copy.automated : copy.operator)} — {journey.evidence.at}</p>
        {journey.evidence.operation && <p className="ui-caption">{journey.evidence.operation}</p>}
        {!journey.evidence.current && <p className={uiMutedTextClass}>{t(copy.notCurrent)}</p>}
        {journey.evidence.note && <p className="whitespace-pre-wrap break-words ui-caption">{journey.evidence.note}</p>}
      </details>}
    </WorkflowSection>
    <details open={!self}>
      <summary className="cursor-pointer ui-body">{t(copy.manualResult)}</summary>
      <WorkflowSection title={t(copy.operator)}>
      <UiTextarea label={t(copy.evidenceNote)} value={note} disabled={busy} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} />
      <UiButton variant="secondary" disabled={busy || !journey.configured || !note.trim()} onClick={() => onAttest("usage", true, note)}>{t(copy.declareUsage)}</UiButton>
      {journey.evidence.source === "operator" && journey.usage_validated && <UiButton variant="ghost" disabled={busy} onClick={() => onAttest("usage", false, "")}>{t(copy.revokeDeclaration)}</UiButton>}
      </WorkflowSection>
    </details>
    {journey.draft.intent !== "evaluate" && <WorkflowSection title={t(copy.readiness)} description={t(copy.readinessHelp)}>
      {journey.draft.intent === "organization" && <UiTextarea label={t(copy.pilotResults)} hint={t(copy.pilotResultsHelp)} value={readinessNote} disabled={busy} maxLength={1000} rows={3} onChange={(event) => setReadinessNote(event.target.value)} />}
      {checks.map((check) => {
        const entry = journey.readiness[check];
        const checked = Boolean(entry?.checked && entry.current);
        const needsNote = ["pilot_allowed", "pilot_denied", "isolation"].includes(check);
        return <div key={check}>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 ui-body">
            <input className={uiCheckboxClass} type="checkbox" checked={checked} disabled={busy || !journey.configured || (!checked && needsNote && !readinessNote.trim())} onChange={(event) => onAttest(check, event.target.checked, needsNote ? readinessNote : "")} />
            {t(onboardingChecks[check])}
          </label>
          {entry?.note && <p className="ml-7 whitespace-pre-wrap break-words ui-caption">{entry.note}</p>}
          {entry?.checked && !entry.current && <p className={uiMutedTextClass}>{t(copy.notCurrent)}</p>}
        </div>;
      })}
      <Link to="/admin/general-settings" className="text-primary underline">{t(copy.later)}</Link>
    </WorkflowSection>}
  </>;
}
