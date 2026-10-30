/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  adminRevokeSession,
  decideExternalLinkRequest,
  listAdminSessions,
  listExternalLinkRequests,
  type AdminSecuritySession,
  type ExternalLinkRequest,
} from "../../api/security";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiDetails from "../../components/ui/UiDetails";
import { cx, type UiTone, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { uiPrincipalRoleLabel } from "./AssociationSummary";
import { useIdentitySecurityI18n, type IdentitySecurityMessageKey, type IdentitySecurityText } from "./identitySecurityMessage";

type PendingLinkDecision = {
  request: ExternalLinkRequest;
  approve: boolean;
};

type IdentitySecurityView = "requests" | "sessions";

const AUTH_TYPE_LABELS: Record<string, IdentitySecurityMessageKey> = {
  ldap: "ldap",
  oidc: "oidc",
  passkey: "passkey",
  password: "password",
  s3: "s3AccessKey",
  s3_session: "s3AccessKey",
  webauthn: "passkey",
};

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function roleTone(role?: string | null): UiTone {
  if (role === "ui_superadmin" || role === "ui_admin") return "primary";
  if (role === "ui_none") return "warning";
  return "neutral";
}

function authenticationLabel(authType: string, text: IdentitySecurityText): string {
  const key = AUTH_TYPE_LABELS[authType.toLowerCase()];
  return key ? text(key) : authType.replaceAll("_", " ");
}

function providerLabel(providerType: string, text: IdentitySecurityText): string {
  const normalized = providerType.toLowerCase();
  if (normalized === "oidc") return text("oidc");
  if (normalized === "ldap") return text("ldap");
  return providerType.toUpperCase();
}

function requestSourceLabel(source: string | null, text: IdentitySecurityText): string {
  if (source === "login_collision") return text("signInCollision");
  if (source === "profile") return text("profile");
  return source ?? text("unknown");
}

function sessionPrincipalLabel(session: AdminSecuritySession, text: IdentitySecurityText): string {
  if (session.user_full_name) return session.user_full_name;
  if (session.user_email) return session.user_email;
  if (session.user_id) return text("userNumber", { id: session.user_id });
  return text("s3Session");
}

export default function IdentitySecurityPage() {
  const { locale, text } = useIdentitySecurityI18n();
  const textRef = useRef(text);
  textRef.current = text;
  const [activeView, setActiveView] = useState<IdentitySecurityView>("requests");
  const [sessions, setSessions] = useState<AdminSecuritySession[]>([]);
  const [requests, setRequests] = useState<ExternalLinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingLinkDecision, setPendingLinkDecision] = useState<PendingLinkDecision | null>(null);
  const [pendingSession, setPendingSession] = useState<AdminSecuritySession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stepUpLabels = useMemo(() => ({
    title: text("verifyPasskey"),
    description: text("verifyDescription"),
    cancel: text("cancel"),
    close: locale === "en" ? undefined : text("close"),
    cancelled: text("verificationCancelled"),
    failure: (error: unknown) => extractApiError(error, text("verificationFailed")),
  }), [locale, text]);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp(stepUpLabels);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSessions, nextRequests] = await Promise.all([
        listAdminSessions(),
        listExternalLinkRequests(),
      ]);
      setSessions(nextSessions);
      setRequests(nextRequests);
    } catch (loadError) {
      setError(extractApiError(loadError, textRef.current("loadError")));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async () => {
    if (!pendingLinkDecision) return;
    const { request, approve } = pendingLinkDecision;
    setBusy(request.id);
    setError(null);
    try {
      const operation = () => decideExternalLinkRequest(request.id, approve);
      if (approve) await runWithStepUp(operation);
      else await operation();
      setPendingLinkDecision(null);
      setMessage(text(approve ? "linkApproved" : "linkRejected"));
      await load();
    } catch (actionError) {
      if (!isRecentWebAuthnVerificationCancelled(actionError)) {
        setError(extractApiError(actionError, text("updateError")));
      }
    } finally {
      setBusy(null);
    }
  };

  const showData = !loading && !error;

  const requestColumns = useMemo<Array<DataTableColumn<ExternalLinkRequest>>>(
    () => [
      {
        id: "account",
        label: text("localAccount"),
        primary: true,
        render: (request) => (
          <div className="min-w-0 space-y-1">
            <p className={cx("break-all", uiTitleTextClass)}>{request.user_email}</p>
            <UiBadge tone={roleTone(request.user_role)}>{uiPrincipalRoleLabel(request.user_role)}</UiBadge>
          </div>
        ),
      },
      {
        id: "external-sign-in",
        label: text("externalSignIn"),
        render: (request) => (
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <UiBadge tone="info">{providerLabel(request.provider_type, text)}</UiBadge>
              {request.provider_type === "oidc" && request.email_verified
                ? <UiBadge tone="success">{text("verifiedEmail")}</UiBadge>
                : null}
            </div>
            <p className={cx("break-all ui-caption", uiMutedTextClass)}>{request.provider_id}</p>
            <p className="break-all">{request.email}</p>
          </div>
        ),
      },
      {
        id: "request-context",
        label: text("request"),
        render: (request) => (
          <div className="space-y-1 ui-caption">
            <p>{requestSourceLabel(request.request_source, text)}</p>
            <time dateTime={request.created_at}>{formatDate(request.created_at, locale)}</time>
            <p className={uiMutedTextClass}>{text("expiresOn", { date: formatDate(request.expires_at, locale) })}</p>
          </div>
        ),
      },
      {
        id: "actions",
        label: text("actions"),
        align: "right",
        mobileRole: "actions",
        render: (request) => (
          <div className="flex flex-wrap justify-end gap-2">
            <ListActionButton variant="primary"
              disabled={busy === request.id}
              onClick={() => setPendingLinkDecision({ request, approve: true })}
            >
              {text("approve")}
            </ListActionButton>
            <ListActionButton
              variant="danger"
              disabled={busy === request.id}
              onClick={() => setPendingLinkDecision({ request, approve: false })}
            >
              {text("reject")}
            </ListActionButton>
          </div>
        ),
      },
    ],
    [busy, locale, text],
  );

  const sessionColumns = useMemo<Array<DataTableColumn<AdminSecuritySession>>>(
    () => [
      {
        id: "user",
        label: text("user"),
        primary: true,
        render: (session) => (
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className={cx("truncate", uiTitleTextClass)}>{sessionPrincipalLabel(session, text)}</p>
              {session.current ? <UiBadge tone="success">{text("current")}</UiBadge> : null}
            </div>
            <p className={cx("break-all ui-caption", uiMutedTextClass)}>
              {session.user_full_name && session.user_email
                ? session.user_email
                : session.s3_session_id ?? session.user_email ?? session.id}
            </p>
          </div>
        ),
      },
      {
        id: "authentication",
        label: text("authentication"),
        mobileLabel: text("authMethod"),
        render: (session) => (
          <span className="inline-flex justify-self-start">
            <UiBadge tone="info">{authenticationLabel(session.auth_type, text)}</UiBadge>
          </span>
        ),
      },
      {
        id: "role",
        label: text("role"),
        render: (session) => session.user_role
          ? (
              <span className="inline-flex justify-self-start">
                <UiBadge tone={roleTone(session.user_role)}>{uiPrincipalRoleLabel(session.user_role)}</UiBadge>
              </span>
            )
          : <span className={uiMutedTextClass}>{text("notApplicable")}</span>,
      },
      {
        id: "network",
        label: text("network"),
        render: (session) => session.ip_address ?? <span className={uiMutedTextClass}>{text("unknown")}</span>,
      },
      {
        id: "activity",
        label: text("lastActivity"),
        render: (session) => <time dateTime={session.last_activity_at}>{formatDate(session.last_activity_at, locale)}</time>,
      },
      {
        id: "actions",
        label: text("actions"),
        align: "right",
        mobileRole: "actions",
        render: (session) => session.revoked_at
          ? <UiBadge>{text("revoked")}</UiBadge>
          : <ListActionButton  variant="danger" onClick={() => setPendingSession(session)}>{text("revoke")}</ListActionButton>,
      },
    ],
    [locale, text],
  );

  const revokeSession = async () => {
    if (!pendingSession) return;
    setBusy(pendingSession.id);
    setError(null);
    try {
      await adminRevokeSession(pendingSession.id);
      setPendingSession(null);
      setMessage(text("sessionRevoked"));
      await load();
    } catch (actionError) {
      setError(extractApiError(actionError, text("revokeError")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageShell actionPresentation="listing"
      title={text("title")}
      description={text("description")}
      breadcrumbs={adminPageBreadcrumbs("identity-security").map((breadcrumb, index) => ({ ...breadcrumb, label: text(index === 0 ? "admin" : "title") }))}

    >
      {error ? (
        <PageBanner tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <UiButton size="xs" variant="secondary" onClick={() => void load()}>{text("retry")}</UiButton>
          </div>
        </PageBanner>
      ) : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      {loading ? <PageBanner tone="info">{text("loading")}</PageBanner> : null}

      {showData ? (
        <>
          <PageTabs
            activeTab={activeView}
            onChange={(view) => setActiveView(view as IdentitySecurityView)}
            variant="line"
            ariaLabel={text("views")}
            idPrefix="identity-security"
            tabs={[
              {
                id: "requests",
                label: text("linkRequests", { count: requests.length }),
                content: (
                  <ListPageSection
                    title={text("requestTitle")}
                    secondaryContent={<p>{text("requestHelp")}</p>}
                    variant="page"
                    actions={<ListActionButton loading={loading} onClick={() => void load()}>{text("refresh")}</ListActionButton>}
                  >
                    <DataTableShell
                      columns={requestColumns}
                      rows={requests}
                      rowKey={(request) => request.id}
                      status={resolveListTableStatus({ loading, error, rowCount: requests.length })}
                      loadingMessage={text("loadingRequests")}
                      errorMessage={text("requestsError")}
                      emptyMessage={text("noRequests")}
                      primaryColumnId="account"
                      responsiveCards
                      tableClassName="ui-data-table"
                      rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
                    />
                  </ListPageSection>
                ),
              },
              {
                id: "sessions",
                label: text("activeSessions", { count: sessions.length }),
                content: (
                  <ListPageSection
                    title={text("sessionTitle")}
                    secondaryContent={<p>{text("sessionHelp")}</p>}
                    variant="page"
                    actions={<ListActionButton loading={loading} onClick={() => void load()}>{text("refresh")}</ListActionButton>}
                  >
                    <DataTableShell
                      columns={sessionColumns}
                      rows={sessions}
                      rowKey={(session) => session.id}
                      status={resolveListTableStatus({ loading, error, rowCount: sessions.length })}
                      loadingMessage={text("loadingSessions")}
                      errorMessage={text("sessionsError")}
                      emptyMessage={text("noSessions")}
                      primaryColumnId="user"
                      responsiveCards
                      tableClassName="ui-data-table"
                      rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
                    />
                  </ListPageSection>
                ),
              },
            ]}
          />
        </>
      ) : null}

      {pendingLinkDecision ? (
        <ConfirmActionDialog
          cancelLabel={text("cancel")}
          processingLabel={text("processing")}
          closeLabel={locale === "en" ? undefined : text("close")}
          title={text(pendingLinkDecision.approve ? "approveTitle" : "rejectTitle")}
          description={text(pendingLinkDecision.approve ? "approveDescription" : "rejectDescription")}
          confirmLabel={text(pendingLinkDecision.approve ? "approveLink" : "rejectRequest")}
          tone={pendingLinkDecision.approve ? "primary" : "danger"}
          loading={busy === pendingLinkDecision.request.id}
          details={[
            { label: text("localAccount"), value: pendingLinkDecision.request.user_email },
            { label: text("externalSignIn"), value: pendingLinkDecision.request.email },
            { label: text("provider"), value: `${providerLabel(pendingLinkDecision.request.provider_type, text)} · ${pendingLinkDecision.request.provider_id}` },
          ]}
          warning={pendingLinkDecision.approve ? text("approvalSignsOutUser") : undefined}
          warningTone="warning"
          secondaryContent={(
            <UiDetails className="rounded-lg border border-[var(--ui-border-soft)] px-3 py-2">
              <summary className="cursor-pointer settings-label">{text("technicalDetails")}</summary>
              <dl className="mt-3 grid gap-2">
                {pendingLinkDecision.request.provider_type === "oidc" ? (
                  <>
                    <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="settings-label">{text("issuer")}</dt>
                      <dd className="settings-body min-w-0 break-all font-mono">{pendingLinkDecision.request.issuer ?? text("unknown")}</dd>
                    </div>
                    <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="settings-label">{text("emailVerified")}</dt>
                      <dd className="settings-body">{text(pendingLinkDecision.request.email_verified ? "yes" : "no")}</dd>
                    </div>
                  </>
                ) : null}
                <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="settings-label">{text("subject")}</dt>
                  <dd className="settings-body min-w-0 break-all font-mono">{pendingLinkDecision.request.subject}</dd>
                </div>
                <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="settings-label">{text("requestSource")}</dt>
                  <dd className="settings-body">{requestSourceLabel(pendingLinkDecision.request.request_source, text)}</dd>
                </div>
                <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="settings-label">{text("requested")}</dt>
                  <dd className="settings-body">{formatDate(pendingLinkDecision.request.created_at, locale)}</dd>
                </div>
                <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="settings-label">{text("expires")}</dt>
                  <dd className="settings-body">{formatDate(pendingLinkDecision.request.expires_at, locale)}</dd>
                </div>
              </dl>
            </UiDetails>
          )}
          onCancel={() => setPendingLinkDecision(null)}
          onConfirm={() => void decide()}
        />
      ) : null}

      {pendingSession ? (
        <ConfirmActionDialog
          cancelLabel={text("cancel")}
          processingLabel={text("processing")}
          closeLabel={locale === "en" ? undefined : text("close")}
          title={text("revokeSession")}
          description={text("revokeDescription")}
          confirmLabel={text("revokeSession")}
          loading={busy === pendingSession.id}
          details={[{ label: text("session"), value: pendingSession.id }]}
          onCancel={() => setPendingSession(null)}
          onConfirm={() => void revokeSession()}
        />
      ) : null}
      {verificationDialog}
    </PageShell>
  );
}
