/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useState, type ReactNode } from "react";

import type { MultisiteObservation } from "../../../api/cephMultisite";
import UiBadge from "../../../components/ui/UiBadge";
import UiDetails from "../../../components/ui/UiDetails";
import UiDrawer, {
  UiDrawerBody,
  UiDrawerCloseButton,
  UiDrawerFooter,
  UiDrawerHeader,
} from "../../../components/ui/UiDrawer";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { type UiTone, uiMutedTextClass } from "../../../components/ui/styles";
import { formatTimestamp, observationAvailabilityLabel, safeJson, type MultisiteText } from "./multisiteUtils";

function availabilityTone(observation: Pick<MultisiteObservation<unknown>, "availability" | "stale">): UiTone {
  if (observation.stale) return "warning";
  if (observation.availability === "denied") return "danger";
  if (["unavailable", "misconfigured", "unsupported"].includes(observation.availability)) return "warning";
  if (observation.availability === "available") return "info";
  return "neutral";
}

export function ObservationBadge({
  observation,
  text,
}: {
  observation: Pick<MultisiteObservation<unknown>, "availability" | "stale">;
  text: MultisiteText;
}) {
  return <UiBadge tone={availabilityTone(observation)}>{observationAvailabilityLabel(observation, text)}</UiBadge>;
}

export function ObservationNotice({
  observation,
  text,
}: {
  observation: MultisiteObservation<unknown>;
  text: MultisiteText;
}) {
  if (observation.availability === "available" && !observation.stale && !observation.reason_code) return null;
  const tone =
    observation.availability === "denied"
      ? "error"
      : observation.stale || ["unavailable", "misconfigured", "unsupported"].includes(observation.availability)
        ? "warning"
        : "neutral";
  return (
    <UiInlineMessage tone={tone}>
      <div className="flex flex-wrap items-center gap-2">
        <ObservationBadge observation={observation} text={text} />
        <span>
          {observation.reason_code
            ? text("Reason: {reason}", { reason: observation.reason_code })
            : text("No additional reason was returned.")}
        </span>
        {observation.last_success_at ? (
          <span>{text("Last successful collection: {time}", { time: formatTimestamp(observation.last_success_at) })}</span>
        ) : null}
      </div>
    </UiInlineMessage>
  );
}

export function PhaseBadge({ phase, text }: { phase: string | null | undefined; text: MultisiteText }) {
  return <UiBadge tone="neutral">{phase || text("Unknown")}</UiBadge>;
}

export function JsonDetails({
  value,
  text,
  summary,
}: {
  value: unknown;
  text: MultisiteText;
  summary?: string;
}) {
  return (
    <UiDetails className="rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)]">
      <summary className="cursor-pointer px-3 py-2 ui-caption font-semibold">
        {summary ?? text("JSON details")}
      </summary>
      <pre className="max-h-96 overflow-auto border-t border-[color:var(--ui-border-soft)] p-3 ui-caption whitespace-pre-wrap [overflow-wrap:anywhere]">
        {safeJson(value)}
      </pre>
    </UiDetails>
  );
}

function useMobileDrawer() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1023px)").matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function MultisiteDetailDrawer({
  title,
  subtitle,
  children,
  onClose,
  text,
  returnFocus,
  surfaceClassName = "w-full lg:w-[44rem]",
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  text: MultisiteText;
  returnFocus?: () => HTMLElement | null;
  surfaceClassName?: string;
}) {
  const mobile = useMobileDrawer();
  return (
    <UiDrawer
      ariaLabelledBy="multisite-drawer-title"
      modal={mobile}
      showBackdrop={mobile}
      onClose={onClose}
      returnFocus={returnFocus}
      surfaceClassName={surfaceClassName}
      backdropLabel={text("Close details")}
    >
      <UiDrawerHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="multisite-drawer-title" className="ui-title font-semibold [overflow-wrap:anywhere]">{title}</h2>
            {subtitle ? <div className={`mt-1 ui-caption ${uiMutedTextClass}`}>{subtitle}</div> : null}
          </div>
          <UiDrawerCloseButton label={text("Close details")} onClose={onClose} />
        </div>
      </UiDrawerHeader>
      <UiDrawerBody className="space-y-4">{children}</UiDrawerBody>
      <UiDrawerFooter>
        <div className="flex items-center justify-between gap-3">
          <span className={`ui-caption ${uiMutedTextClass}`}>{text("Read only")}</span>
          <button type="button" className="ui-list-action ui-list-action-secondary" onClick={onClose}>
            {text("Close")}
          </button>
        </div>
      </UiDrawerFooter>
    </UiDrawer>
  );
}

export function ProvenanceSummary({
  observation,
  text,
}: {
  observation: MultisiteObservation<unknown>;
  text: MultisiteText;
}) {
  return (
    <dl className="grid gap-2 ui-caption sm:grid-cols-2">
      <div>
        <dt className={uiMutedTextClass}>{text("Collected at")}</dt>
        <dd>{formatTimestamp(observation.collected_at)}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("Endpoint ID")}</dt>
        <dd>{observation.provenance.endpoint_id}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("Local zone")}</dt>
        <dd>{observation.provenance.local_zone_id ?? "—"}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("Source zone")}</dt>
        <dd>{observation.provenance.source_zone_id ?? "—"}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("Operation")}</dt>
        <dd>{observation.provenance.operation}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("HTTP status")}</dt>
        <dd>{observation.provenance.http_status ?? "—"}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("Duration")}</dt>
        <dd>{text("{duration} ms", { duration: observation.provenance.duration_ms })}</dd>
      </div>
      <div>
        <dt className={uiMutedTextClass}>{text("Collection ID")}</dt>
        <dd className="[overflow-wrap:anywhere]">{observation.provenance.collection_id}</dd>
      </div>
    </dl>
  );
}
