/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "../../components/ModalActions";
import { ListBadge, ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  ApiTokenInfo,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../../api/apiTokens";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import ListPageSection from "../../components/list/ListPageSection";
import { SettingsButton, SettingsDialog } from "../../components/settings/SettingsControls";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";

import { toolbarCompactToggleClasses } from "../../components/toolbarControlClasses";
import { uiCheckboxClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { stableSignature } from "../../utils/stableSignature";

type TokenStatus = "active" | "expired" | "revoked";

type RevealedToken = {
  value: string;
  token: ApiTokenInfo;
};

const DEFAULT_EXPIRY_DAYS = 30;
const API_SCOPES = [
  "profile:read", "profile:write", "admin:read", "admin:write", "manager:read", "manager:write",
  "browser:read", "browser:write", "portal:read", "portal:write", "ceph-admin:read", "ceph-admin:write",
  "storage-ops:read", "storage-ops:write",
];

function extractError(error: unknown): string {
  return extractApiError(error, "Unable to complete request.");
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function resolveTokenStatus(token: ApiTokenInfo): TokenStatus {
  if (token.revoked_at) return "revoked";
  const expiry = new Date(token.expires_at);
  if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) return "expired";
  return "active";
}

function StatusBadge({ status }: { status: TokenStatus }) {
  return (
    <ListBadge tone={status === "active" ? "success" : status === "expired" ? "warning" : "neutral"} className="uppercase tracking-wide">
      {status}
    </ListBadge>
  );
}

type ApiTokensPageProps = {
  showPageHeader?: boolean;
  onUnsavedChangesChange?: (dirty: boolean) => void;
};

export default function ApiTokensPage({ showPageHeader = true, onUnsavedChangesChange }: ApiTokensPageProps) {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [scopes, setScopes] = useState<string[]>(["profile:read"]);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [createAttempted, setCreateAttempted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const scopesRef = useRef<HTMLFieldSetElement>(null);
  const scopesErrorId = useId();
  const [invalidExpiryInput, setInvalidExpiryInput] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createInitialSignature, setCreateInitialSignature] = useState(() =>
    stableSignature({ tokenName: "", expiresInDays: String(DEFAULT_EXPIRY_DAYS), scopes: ["profile:read"] })
  );

  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<RevealedToken | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const revokeConfirmation = useConfirmActionDialog();
  const {
    runWithStepUp,
    verificationDialog,
  } = useRecentWebAuthnStepUp();

  const apiBase = useMemo(() => {
    const configured = (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, "");
    return new URL(configured || "/", window.location.origin).href.replace(/\/+$/, "");
  }, []);

  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => {
      const left = new Date(a.created_at).getTime();
      const right = new Date(b.created_at).getTime();
      if (Number.isNaN(left) || Number.isNaN(right)) return 0;
      return right - left;
    });
  }, [tokens]);
  const tableStatus = resolveListTableStatus({
    loading,
    error: loadError,
    rowCount: sortedTokens.length,
  });

  const loadTokens = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listApiTokens(includeRevoked);
      if (generation === loadGeneration.current) setTokens(data);
    } catch (loadError) {
      if (generation === loadGeneration.current) setLoadError(extractError(loadError));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [includeRevoked]);

  useEffect(() => {
    void loadTokens();
    return () => { loadGeneration.current += 1; };
  }, [loadTokens]);

  const resetCreateForm = () => {
    setTokenName("");
    setExpiresInDays(String(DEFAULT_EXPIRY_DAYS));
    setScopes(["profile:read"]);
    setFormError(null);
    setCreateAttempted(false);
    setInvalidExpiryInput(false);
    setCreateInitialSignature(stableSignature({ tokenName: "", expiresInDays: String(DEFAULT_EXPIRY_DAYS), scopes: ["profile:read"] }));
  };

  const openCreateModal = () => {
    if (creatingRef.current) return;
    resetCreateForm();
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    if (creatingRef.current) return;
    setShowCreateModal(false);
    setFormError(null);
  };

  const createCurrentSignature = useMemo(
    () => stableSignature({ tokenName, expiresInDays, scopes: [...scopes].sort() }),
    [expiresInDays, scopes, tokenName]
  );
  const createHasUnsavedChanges = showCreateModal && createCurrentSignature !== createInitialSignature;
  useEffect(() => {
    onUnsavedChangesChange?.(createHasUnsavedChanges);
  }, [createHasUnsavedChanges, onUnsavedChangesChange]);
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: createHasUnsavedChanges,
    onClose: closeCreateModal,
    disabled: creating,
  });

  const nameError = !tokenName.trim() ? "Token name is required." : undefined;
  const scopesError = scopes.length === 0 ? "Select at least one scope." : undefined;
  const normalizedDays = expiresInDays.trim();
  const expiryError = invalidExpiryInput || (normalizedDays && (!Number.isSafeInteger(Number(normalizedDays)) || Number(normalizedDays) < 1))
    ? "Expiry must be a positive integer (days)." : undefined;

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (creatingRef.current) return;
    setFormError(null);
    setActionMessage(null);
    setCreateAttempted(true);
    const normalizedName = tokenName.trim();
    if (nameError || expiryError || scopesError) {
      if (nameError) nameRef.current?.focus();
      else if (expiryError) expiryRef.current?.focus();
      else scopesRef.current?.querySelector("input")?.focus();
      return;
    }
    const payloadDays = normalizedDays ? Number(normalizedDays) : undefined;
    creatingRef.current = true;
    setCreating(true);
    try {
      const created = await runWithStepUp(() => createApiToken({
          name: normalizedName,
          expires_in_days: payloadDays,
          scopes,
        }));
      setRevealedToken({ value: created.access_token, token: created.api_token });
      setCopyMessage(null);
      setActionMessage("API token created.");
      setShowCreateModal(false);
      await loadTokens();
    } catch (createError) {
      if (!isRecentWebAuthnVerificationCancelled(createError)) {
        setFormError(extractError(createError));
      }
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const revokeToken = async (token: ApiTokenInfo) => {
    const status = resolveTokenStatus(token);
    if (status !== "active") return;
    setBusyTokenId(token.id);
    setActionMessage(null);
    setActionError(null);
    try {
      await revokeApiToken(token.id);
      setActionMessage("API token revoked.");
      await loadTokens();
    } catch (revokeError) {
      if (!isRecentWebAuthnVerificationCancelled(revokeError)) {
        setActionError(extractError(revokeError));
      }
    } finally {
      setBusyTokenId(null);
    }
  };

  const handleRevoke = (token: ApiTokenInfo) => {
    if (resolveTokenStatus(token) !== "active") return;
    revokeConfirmation.requestConfirmation({
      title: "Revoke API token?",
      description: "Immediately invalidate this automation token.",
      confirmLabel: "Revoke token",
      details: [
        { label: "Token", value: token.name },
        { label: "Scopes", value: token.scopes.join(", "), mono: true },
      ],
      impacts: ["Existing scripts and integrations using this token will stop authenticating."],
      onConfirm: () => revokeToken(token),
    });
  };

  const copyAndNotify = async (value: string, message: string) => {
    try {
      await copyTextToClipboard(value);
      setCopyMessage(message);
      window.setTimeout(() => setCopyMessage(null), 2500);
    } catch (copyError) {
      setActionError(extractError(copyError));
    }
  };

  const authHeaderSnippet = revealedToken ? `Authorization: Bearer ${revealedToken.value}` : "";
  const curlSnippet = revealedToken
    ? [
        `curl -X GET "${apiBase}/users/me" \\`,
        `  -H "Authorization: Bearer ${revealedToken.value}"`,
      ].join("\n")
    : "";
  const ansibleSnippet = revealedToken
    ? [
        "headers:",
        `  Authorization: "Bearer ${revealedToken.value}"`,
        '  Content-Type: "application/json"',
      ].join("\n")
    : "";
  const headerActions = [
    {
      label: "Create token",
      onClick: openCreateModal,
    },
  ];
  const tokenTableColumns: Array<DataTableColumn<ApiTokenInfo>> = [
    {
      id: "name",
      label: "Name",
      primary: true,
      render: (token) => token.name,
    },
    {
      id: "created",
      label: "Created",
      render: (token) => formatDate(token.created_at),
    },
    {
      id: "expires",
      label: "Expires",
      render: (token) => formatDate(token.expires_at),
    },
    {
      id: "last-used",
      label: "Last used",
      render: (token) => formatDate(token.last_used_at),
    },
    {
      id: "status",
      label: "Status",
      render: (token) => <StatusBadge status={resolveTokenStatus(token)} />,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (token) => {
        const status = resolveTokenStatus(token);
        const isBusy = busyTokenId === token.id;
        return status === "active" ? (
          <ListActionButton
            type="button"
            onClick={() => handleRevoke(token)}
            disabled={isBusy}
             variant="danger"
          >
            {isBusy ? "Revoking..." : "Revoke"}
          </ListActionButton>
        ) : (
          <span className="ui-caption text-slate-400 dark:text-slate-500">-</span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {showPageHeader ? (
        <PageHeader actionPresentation="listing"
          title="API tokens"
          description="Manage long-lived admin tokens for automation and integrations."
          breadcrumbs={adminPageBreadcrumbs("api-tokens")}
          actions={headerActions}
        />
      ) : null}

      {loadError && sortedTokens.length > 0 ? <PageBanner tone="error">{loadError}</PageBanner> : null}
      {actionError ? <PageBanner tone="error">{actionError}</PageBanner> : null}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {copyMessage && <PageBanner tone="info">{copyMessage}</PageBanner>}

      {revealedToken && (
        <OneTimeSecretPanel
          title={`New API token: ${revealedToken.token.name}`}
          description="This token is shown only once. Store it securely now."
          badge="One-time display"
          values={[{ label: "Token", value: revealedToken.value }]}
          actions={
            <>
            <SettingsButton variant="secondary"
              onClick={() => copyAndNotify(revealedToken.value, "Token copied to clipboard.")}
            >
              Copy token
            </SettingsButton>
            <SettingsButton variant="secondary"
              onClick={() => copyAndNotify(authHeaderSnippet, "Authorization header copied.")}
            >
              Copy auth header
            </SettingsButton>
            <SettingsButton variant="secondary"
              onClick={() => copyAndNotify(curlSnippet, "cURL example copied.")}
            >
              Copy cURL
            </SettingsButton>
            <SettingsButton variant="secondary"
              onClick={() => copyAndNotify(ansibleSnippet, "Ansible header snippet copied.")}
            >
              Copy Ansible
            </SettingsButton>
            <SettingsButton variant="secondary" onClick={() => { setRevealedToken(null); setCopyMessage(null); }}>Hide token</SettingsButton>
            </>
          }
        />
      )}

      <ListPageSection
          title="API tokens"
          description="Manage long-lived admin tokens for automation and integrations."
          variant={showPageHeader ? "page" : "section"}
          countLabel={`${sortedTokens.length} token${sortedTokens.length === 1 ? "" : "s"}${includeRevoked ? " (including revoked/expired)" : ""}`}
          filters={
            <label className={toolbarCompactToggleClasses}>
              <input
                type="checkbox"
                checked={includeRevoked}
                onChange={(event) => setIncludeRevoked(event.target.checked)}
                className={uiCheckboxClass}
              />
              Show revoked/expired
            </label>
          }
          actions={<ListActionButton onClick={() => void loadTokens()} loading={loading}>Refresh</ListActionButton>}
          headingActions={!showPageHeader ? <ListActionButton variant="primary" onClick={openCreateModal}>Create token</ListActionButton> : undefined}
      >
        <DataTableShell
          columns={tokenTableColumns}
          rows={sortedTokens}
          rowKey={(token) => token.id}
          status={tableStatus}
          loadingMessage="Loading API tokens..."
          errorMessage={loadError ?? "Unable to load API tokens."}
          emptyMessage="No API tokens."
          tableClassName="ui-data-table"
          responsiveCards
        />
      </ListPageSection>

      {revokeConfirmation.confirmationDialog}

      {showCreateModal && (
        <SettingsDialog title="Create API token" onClose={createCloseGuard.requestClose} closeDisabled={creating} initialFocusRef={nameRef} maxWidthClass="max-w-xl">
          <form aria-label="Create API token" className="settings-stack" onSubmit={handleCreate} noValidate>
            <p className="settings-description">
              Create a token for automation (Ansible, CI, scripts). Its secret will be shown once.
            </p>
            <fieldset disabled={creating} className="settings-fields">
              <div className="settings-fields sm:grid-cols-2">
                <UiInput
                  ref={nameRef}
                  label="Token name"
                  type="text"
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  placeholder="ansible-production"
                  maxLength={128}
                  required
                  error={createAttempted ? nameError : undefined}
                />
                <UiInput
                  ref={expiryRef}
                  label="Expiry (days)"
                  type="number"
                  min={1}
                  step={1}
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                  onInput={(event) => setInvalidExpiryInput(event.currentTarget.validity.badInput)}
                  hint="Leave blank to use the server default."
                  error={createAttempted ? expiryError : undefined}
                />
              </div>
              <fieldset ref={scopesRef} aria-invalid={createAttempted && Boolean(scopesError)} aria-describedby={createAttempted && scopesError ? scopesErrorId : undefined} className="min-w-0">
                <legend className="settings-label mb-1">Scopes</legend>
                <div className="grid grid-cols-2 gap-x-2">
                  {API_SCOPES.map((scope) => (
                    <UiCheckboxField key={scope} className="settings-choice settings-description [overflow-wrap:anywhere]"
                      checked={scopes.includes(scope)}
                      onChange={(event) => setScopes((current) => event.target.checked
                        ? [...current, scope]
                        : current.filter((entry) => entry !== scope))}
                    >
                      {scope}
                    </UiCheckboxField>
                  ))}
                </div>
                {createAttempted && scopesError && <p id={scopesErrorId} role="alert" className="settings-description text-rose-700 dark:text-rose-300">{scopesError}</p>}
              </fieldset>
            </fieldset>
            {formError && <PageBanner tone="error">{formError}</PageBanner>}
            <ModalActions>
              <SettingsButton
                type="button"
                onClick={createCloseGuard.requestClose}
                variant="secondary"
                disabled={creating}
              >
                Cancel
              </SettingsButton>
              <SettingsButton
                type="submit"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create token"}
              </SettingsButton>
            </ModalActions>
          </form>
          {createCloseGuard.confirmationDialog}
        </SettingsDialog>
      )}
      {verificationDialog}
    </div>
  );
}
