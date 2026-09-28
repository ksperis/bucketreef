/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import BrandMark from "../BrandMark";
import { useGeneralSettings } from "../GeneralSettingsContext";
import UiButton, { UiButtonLink } from "../ui/UiButton";
import UiDetails from "../ui/UiDetails";
import { PRODUCT_NAME } from "../../constants/product";
import { useI18n } from "../../i18n";
import { classifyApplicationError, isRetryablePageError, type ApplicationErrorKind } from "../../utils/applicationError";
import { resolveRouteErrorHomePath } from "../../utils/routeError";
import { WorkspaceErrorContext } from "./WorkspaceErrorContext";
import { errorActions, errorCopy } from "./errorCopy";
import "./errorState.css";

type StatusAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
};
type ErrorStateProps = {
  kind?: ApplicationErrorKind;
  error?: unknown;
  presentation?: "auto" | "full" | "embedded";
  title?: string;
  description?: ReactNode;
  onRetry?: () => void | Promise<unknown>;
  primaryAction?: StatusAction;
  secondaryAction?: StatusAction;
};

export default function ErrorState({ kind, error, presentation = "auto", title, description, onRetry, primaryAction, secondaryAction }: ErrorStateProps) {
  const workspaceHome = useContext(WorkspaceErrorContext);
  const fullPage = presentation === "full" || (presentation === "auto" && !workspaceHome);
  const { generalSettings, runtimeSurfaces } = useGeneralSettings();
  const home = workspaceHome ?? resolveRouteErrorHomePath(generalSettings, runtimeSurfaces);
  const navigate = useNavigate();
  const { t } = useI18n();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [retryError, setRetryError] = useState<unknown>();
  const model = useMemo(() => classifyApplicationError(retryError ?? error), [error, retryError]);
  const effectiveKind = kind ?? model.kind;
  const copy = errorCopy[effectiveKind];
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString());
  const [copyStatus, setCopyStatus] = useState<"copied" | "copyFailed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil(((model.retryAt ?? 0) - now) / 1000));
  useEffect(() => {
    setRetryError(undefined);
    setCopyStatus(null);
    setObservedAt(new Date().toISOString());
  }, [error]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [effectiveKind]);
  useEffect(() => {
    if (!model.retryAt || model.retryAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= model.retryAt!) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [model.retryAt]);

  const diagnostics = [
    [t(errorActions.category), effectiveKind],
    ...(model.status ? [["HTTP", String(model.status)]] : []),
    [t(errorActions.time), observedAt],
    ...(model.reference ? [[t(errorActions.reference), model.reference]] : []),
  ];
  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics.map(([label, value]) => `${label}: ${value}`).join("\n"));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("copyFailed");
    }
  };
  const retry = async () => {
    if (busy || remaining > 0) return;
    setBusy(true);
    try {
      if (onRetry) await onRetry();
      else window.location.reload();
    } catch (failure) {
      setRetryError(failure);
    } finally {
      setBusy(false);
    }
  };
  const authRequired = ["sign_in", "session_expired", "auth_failed"].includes(effectiveKind);
  const recovery = primaryAction ?? (authRequired
    ? { label: t(effectiveKind === "session_expired" ? errorActions.reconnect : errorActions.login), to: "/login" }
    : effectiveKind === "verification_required"
      ? { label: t(errorActions.security), to: home === "/login" ? home : `${home}/profile?tab=security` }
    : isRetryablePageError(effectiveKind)
      ? { label: t(errorActions.retry), onClick: () => { void retry(); } }
      : { label: t(home === "/login" ? errorActions.login : errorActions.home), to: home });
  const secondary = secondaryAction ?? (effectiveKind === "forbidden"
    ? { label: t(errorActions.switchAccount), to: "/login" }
    : recovery.to !== home && !authRequired
      ? { label: t(home === "/login" ? errorActions.login : errorActions.home), to: home }
      : effectiveKind === "not_found" && (window.history.state?.idx ?? 0) > 0
        ? { label: t(errorActions.previous), onClick: () => navigate(-1) }
        : undefined);
  const renderAction = (action: StatusAction, primary: boolean) => action.to
    ? <UiButtonLink to={action.to} variant={action.variant ?? (primary ? "primary" : "ghost")} className="error-state-action">{action.label}</UiButtonLink>
    : <UiButton onClick={action.onClick} loading={primary && busy} disabled={primary && remaining > 0} variant={action.variant ?? (primary ? "primary" : "ghost")} className="error-state-action">{action.label}</UiButton>;
  const content = (
    <section className="error-state-content" aria-labelledby={headingId} data-error-kind={effectiveKind}>
      <div className="error-state-copy">
        <p className={`error-state-label error-state-label--${copy.tone}`}>{t(copy.label)}</p>
        <h1 id={headingId} ref={heading} tabIndex={-1}>{title ?? t(copy.title)}</h1>
        <div className="error-state-description">{description ?? t(copy.description)}</div>
        <div className="error-state-actions">
          {renderAction(recovery, true)}
          {secondary && renderAction(secondary, false)}
        </div>
        {remaining > 0 && <p className="error-state-wait">{t(errorActions.wait)} {remaining} s</p>}
        <UiDetails className="error-state-details">
          <summary>{t(errorActions.details)}</summary>
          <div className="error-state-diagnostic">
            <dl>{diagnostics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <UiButton variant="secondary" onClick={() => { void copyDetails(); }}>{t(errorActions.copy)}</UiButton>
            <p role="status">{copyStatus ? t(errorActions[copyStatus]) : ""}</p>
          </div>
        </UiDetails>
      </div>
      <img className="error-state-art" src={`/illustrations/errors/${copy.illustration}.webp`} alt="" width="900" height="720" draggable={false} />
    </section>
  );
  return fullPage ? (
    <div className="error-state error-state--full">
      <header className="error-state-header">
        <Link to={home} className="error-state-brand"><BrandMark className="h-11 w-11" /><span>{PRODUCT_NAME}</span></Link>
      </header>
      <main>{content}</main>
      <footer>{t(errorActions.support)}</footer>
    </div>
  ) : <div className="error-state error-state--embedded">{content}</div>;
}
