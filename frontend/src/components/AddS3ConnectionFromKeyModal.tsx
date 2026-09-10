/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ModalActions from "./ModalActions";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createConnection,
  listPrivateConnectionStorageEndpoints,
  type CredentialOwnerType,
  type PrivateConnectionStorageEndpoint,
} from "../api/connections";
import { notifyExecutionContextsRefresh } from "../utils/executionContextRefresh";
import { extractApiError } from "../utils/apiError";
import { stableSignature } from "../utils/stableSignature";
import S3ConnectionAccessFields from "../features/shared/S3ConnectionAccessFields";
import S3ConnectionEndpointFields from "../features/shared/S3ConnectionEndpointFields";
import type { S3ConnectionEndpointMode } from "../features/shared/s3ConnectionFormModel";
import { SettingsButton, SettingsDialog, useSettingsCloseGuard } from "./settings/SettingsControls";
import { SettingsSection } from "./settings/SettingsLayout";
import UiInlineMessage from "./ui/UiInlineMessage";
import UiInput from "./ui/UiInput";
import { focusFirstInvalidField } from "../utils/focusFirstInvalidField";

type Props = {
  isOpen: boolean;
  title?: string;
  zIndexClass?: string;
  lockEndpoint?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  defaultName: string;
  defaultEndpointId?: number | null;
  defaultEndpointUrl?: string | null;
  defaultRegion?: string | null;
  defaultProviderHint?: string | null;
  defaultAccessManager?: boolean;
  defaultAccessBrowser?: boolean;
  defaultOwnerType?: CredentialOwnerType | null;
  defaultOwnerIdentifier?: string | null;
  onClose: () => void;
  onCreated?: () => void;
};

const normalizeProviderHint = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "ceph" || normalized === "aws" || normalized === "scality" || normalized === "minio" || normalized === "other") {
    return normalized;
  }
  return "";
};

const normalizeEndpointUrl = (value?: string | null): string => (value || "").trim().replace(/\/+$/, "");

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

const INITIAL_CONNECTION_FORM = {
  name: "",
  endpoint_url: "",
  region: "",
  provider_hint: "",
  force_path_style: false,
  verify_tls: true,
  access_manager: false,
  access_browser: true,
};

function draftSignature(form: typeof INITIAL_CONNECTION_FORM, mode: S3ConnectionEndpointMode, endpointId: string, locked: boolean) {
  return stableSignature({
    name: form.name,
    access_manager: form.access_manager,
    access_browser: form.access_browser,
    ...(!locked && (mode === "preset" ? { mode, endpointId } : {
      mode, endpoint_url: form.endpoint_url, region: form.region, provider_hint: form.provider_hint,
      force_path_style: form.force_path_style, verify_tls: form.verify_tls,
    })),
  });
}

export default function AddS3ConnectionFromKeyModal({ isOpen, ...props }: Props) {
  if (!isOpen) return null;
  const source = stableSignature([
    props.defaultEndpointId, props.defaultEndpointUrl, props.defaultName, props.defaultRegion,
    props.defaultProviderHint, props.defaultAccessManager, props.defaultAccessBrowser, props.lockEndpoint, props.accessKeyId,
  ]);
  return <ConnectionFromKeyForm key={source} {...props} />;
}

function ConnectionFromKeyForm({
  title = "Add as S3 Connection",
  zIndexClass,
  lockEndpoint = false,
  accessKeyId,
  secretAccessKey,
  defaultName,
  defaultEndpointId,
  defaultEndpointUrl,
  defaultRegion,
  defaultProviderHint,
  defaultAccessManager = false,
  defaultAccessBrowser = true,
  defaultOwnerType,
  defaultOwnerIdentifier,
  onClose,
  onCreated,
}: Omit<Props, "isOpen">) {
  const normalizedDefaultEndpointUrl = normalizeEndpointUrl(defaultEndpointUrl);
  const hasFixedEndpoint = defaultEndpointId != null || Boolean(normalizedDefaultEndpointUrl);
  const endpointLocked = Boolean(lockEndpoint && hasFixedEndpoint);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [endpointMode, setEndpointMode] = useState<S3ConnectionEndpointMode>(defaultEndpointId != null ? "preset" : "custom");
  const [selectedEndpointId, setSelectedEndpointId] = useState(defaultEndpointId != null ? String(defaultEndpointId) : "");

  const [endpoints, setEndpoints] = useState<PrivateConnectionStorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(!endpointLocked);
  const [endpointLoadError, setEndpointLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(() => ({
    ...INITIAL_CONNECTION_FORM,
    name: defaultName,
    endpoint_url: defaultEndpointUrl || "",
    region: defaultRegion || "",
    provider_hint: normalizeProviderHint(defaultProviderHint),
    access_manager: Boolean(defaultAccessManager),
    access_browser: defaultAccessBrowser !== false,
  }));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name" | "endpointId" | "endpointUrl" | "access", string>>>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const [initialSignature] = useState(() => draftSignature(form, endpointMode, selectedEndpointId, endpointLocked));

  useEffect(() => {
    if (endpointLocked) {
      setEndpoints([]);
      setLoadingEndpoints(false);
      setEndpointLoadError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingEndpoints(true);
      setEndpointLoadError(null);
      try {
        const data = await listPrivateConnectionStorageEndpoints();
        if (cancelled) return;
        setEndpoints(data);
      } catch (err) {
        if (cancelled) return;
        setEndpoints([]);
        setEndpointLoadError(extractError(err));
      } finally {
        if (!cancelled) {
          setLoadingEndpoints(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [endpointLocked]);

  const changeEndpointMode = (mode: S3ConnectionEndpointMode) => {
    setEndpointMode(mode);
    setFieldErrors((current) => ({ ...current, endpointId: undefined, endpointUrl: undefined }));
    if (mode !== "preset" || endpoints.some((endpoint) => String(endpoint.id) === selectedEndpointId)) return;
    const preferred = endpoints.find((endpoint) => endpoint.id === defaultEndpointId)
      ?? endpoints.find((endpoint) => normalizeEndpointUrl(endpoint.endpoint_url) === normalizedDefaultEndpointUrl)
      ?? endpoints.find((endpoint) => endpoint.is_default)
      ?? endpoints[0];
    setSelectedEndpointId(preferred ? String(preferred.id) : "");
  };

  const changeForm = <K extends keyof typeof INITIAL_CONNECTION_FORM>(field: K, value: typeof INITIAL_CONNECTION_FORM[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    const errorField = field === "name" ? "name" : field === "endpoint_url" ? "endpointUrl"
      : field === "access_manager" || field === "access_browser" ? "access" : undefined;
    if (errorField) setFieldErrors((current) => ({ ...current, [errorField]: undefined }));
  };

  const ownerSummary = useMemo(() => {
    if (!defaultOwnerType && !defaultOwnerIdentifier) return null;
    if (defaultOwnerType && defaultOwnerIdentifier) return `${defaultOwnerType}: ${defaultOwnerIdentifier}`;
    return defaultOwnerType || defaultOwnerIdentifier || null;
  }, [defaultOwnerIdentifier, defaultOwnerType]);
  const showEndpointSection = !endpointLocked;
  const currentSignature = useMemo(
    () => draftSignature(form, endpointMode, selectedEndpointId, endpointLocked),
    [endpointMode, form, selectedEndpointId, endpointLocked]
  );
  const hasUnsavedChanges = Boolean(initialSignature) && currentSignature !== initialSignature;
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges,
    disabled: saving,
    onClose,
    zIndexClass: "z-[80]",
  });

  const waitingForPreset = !endpointLocked && endpointMode === "preset" && loadingEndpoints;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving || waitingForPreset) return;
    const name = form.name.trim();
    const errors: typeof fieldErrors = {};
    if (!name) errors.name = "Name is required.";
    if (!endpointLocked && endpointMode === "preset" && !endpoints.some((endpoint) => String(endpoint.id) === selectedEndpointId)) {
      errors.endpointId = "Select an available configured endpoint.";
    }
    if (!endpointLocked && endpointMode === "custom") {
      if (!form.endpoint_url.trim()) errors.endpointUrl = "Endpoint URL is required for a custom endpoint.";
      else if (e.currentTarget.querySelector<HTMLInputElement>('input[type="url"]')?.validity.typeMismatch) {
        errors.endpointUrl = "Enter a valid endpoint URL.";
      }
    }
    if (!form.access_manager && !form.access_browser) errors.access = "Enable access to manager and/or browser.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalidField(e.currentTarget);
      return;
    }
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      setError("Access key and secret key are required.");
      return;
    }

    const resolvedStorageEndpointId = endpointLocked ? defaultEndpointId ?? null : endpointMode === "preset" ? Number(selectedEndpointId) : null;
    const resolvedEndpointUrl = endpointLocked
      ? normalizedDefaultEndpointUrl
      : endpointMode === "custom"
        ? form.endpoint_url.trim()
        : "";

    if (!resolvedStorageEndpointId && !resolvedEndpointUrl) {
      setError("Endpoint URL is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createConnection({
        name,
        storage_endpoint_id: resolvedStorageEndpointId,
        endpoint_url: resolvedStorageEndpointId ? undefined : resolvedEndpointUrl,
        region: !resolvedStorageEndpointId ? form.region.trim() || null : undefined,
        provider_hint: !resolvedStorageEndpointId ? form.provider_hint || null : undefined,
        force_path_style: !resolvedStorageEndpointId ? form.force_path_style : undefined,
        verify_tls: !resolvedStorageEndpointId ? form.verify_tls : undefined,
        access_key_id: accessKeyId.trim(),
        secret_access_key: secretAccessKey.trim(),
        access_manager: Boolean(form.access_manager),
        access_browser: Boolean(form.access_browser),
        credential_owner_type: defaultOwnerType || null,
        credential_owner_identifier: defaultOwnerIdentifier || null,
      });
      notifyExecutionContextsRefresh();
      onCreated?.();
      onClose();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog title={title} onClose={closeGuard.requestClose} closeDisabled={saving}
      initialFocusRef={nameRef} maxWidthClass="max-w-3xl" zIndexClass={zIndexClass}>
      <form className="settings-form" onSubmit={submit} noValidate>
        <fieldset disabled={saving} className="settings-stack min-w-0">
          {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
          <div>
            <SettingsSection title="Connection" description="This creates a private S3 connection (owner only)." presentation="compact">
              <UiInput ref={nameRef} label="Name" value={form.name} error={fieldErrors.name}
                onChange={(event) => changeForm("name", event.target.value)} required />
            </SettingsSection>
            {showEndpointSection && (
              <S3ConnectionEndpointFields
                mode={endpointMode}
                onModeChange={changeEndpointMode}
                modeInputName="add-s3-connection-endpoint-mode"
                endpointId={selectedEndpointId}
                onEndpointIdChange={(id) => { setSelectedEndpointId(id); setFieldErrors((current) => ({ ...current, endpointId: undefined })); }}
                endpoints={endpoints}
                loadingEndpoints={loadingEndpoints}
                form={form}
                onFormChange={(field, value) => {
                  setForm((current) => ({ ...current, [field]: value }));
                  if (field === "endpoint_url") setFieldErrors((current) => ({ ...current, endpointUrl: undefined }));
                }}
                endpointIdError={fieldErrors.endpointId}
                endpointUrlError={fieldErrors.endpointUrl}
                errorMessage={endpointLoadError ? `Endpoint list unavailable (${endpointLoadError}). Use custom endpoint mode.` : null}
              />
            )}
            <SettingsSection title="Access" presentation="compact">
              <S3ConnectionAccessFields
                accessManager={form.access_manager}
                accessBrowser={form.access_browser}
                onAccessManagerChange={(checked) => changeForm("access_manager", checked)}
                onAccessBrowserChange={(checked) => changeForm("access_browser", checked)}
                ownerSummary={ownerSummary}
                error={fieldErrors.access}
                className="settings-fields"
              />
            </SettingsSection>
          </div>
          <ModalActions>
            <SettingsButton onClick={closeGuard.requestClose} variant="secondary">Cancel</SettingsButton>
            <SettingsButton type="submit" disabled={waitingForPreset}>
              {saving ? "Creating..." : "Create private connection"}
            </SettingsButton>
          </ModalActions>
        </fieldset>
      </form>
      {closeGuard.confirmationDialog}
    </SettingsDialog>
  );
}
