/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import {
  type CephAdminBucket,
} from "../../api/cephAdminBuckets";
import {
  listCephAdminAccounts,
  type CephAdminRgwAccount,
} from "../../api/cephAdminAccounts";
import {
  listCephAdminUsers,
  type CephAdminRgwUser,
} from "../../api/cephAdminUsers";
import {
  checkCephAdminBucketIndex,
  type CephAdminAdminOpsResult,
  deleteCephAdminAccount,
  deleteCephAdminBucket,
  deleteCephAdminUser,
  linkCephAdminBucket,
  unlinkCephAdminBucket,
} from "../../api/cephAdminAdminOps";
import Modal from "../../components/Modal";
import ModalActions from "../../components/ModalActions";
import ModalOptions from "../../components/ModalOptions";
import InlineSummary from "../../components/InlineSummary";
import { ListActionButton, ListBadge } from "../../components/list/ListControls";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiDetails from "../../components/ui/UiDetails";
import UiSelect from "../../components/ui/UiSelect";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { cx, uiMutedTextClass, uiPanelMutedClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";

type AccountAction = {
  kind: "delete-account";
  account: CephAdminRgwAccount;
};

type UserAction = {
  kind: "delete-user";
  user: CephAdminRgwUser;
};

export type BucketAdminOpsKind = "delete-bucket" | "unlink-bucket" | "link-bucket" | "index-check";

type BucketAction = {
  kind: BucketAdminOpsKind;
  bucket: CephAdminBucket;
};

export type CephAdminAdminOpsAction = AccountAction | UserAction | BucketAction;

type LinkTarget = {
  type: "user" | "account";
  id: string;
  label: string;
};

type Props = {
  endpointId: number;
  endpointName?: string | null;
  action: CephAdminAdminOpsAction;
  canAccounts?: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function userId(user: CephAdminRgwUser): string {
  return user.tenant ? `${user.tenant}$${user.uid}` : user.uid;
}

function bucketId(bucket: CephAdminBucket): string {
  return bucket.tenant ? `${bucket.tenant}/${bucket.name}` : bucket.name;
}

function structuredResultFromError(error: unknown): CephAdminAdminOpsResult | null {
  const responseData = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!responseData || typeof responseData !== "object") return null;
  const candidate = responseData as Partial<CephAdminAdminOpsResult>;
  if (typeof candidate.operation !== "string" || typeof candidate.success !== "boolean") return null;
  return {
    operation: candidate.operation,
    success: candidate.success,
    rgw_status_code: candidate.rgw_status_code ?? null,
    rgw_error_code: candidate.rgw_error_code ?? null,
    message: typeof candidate.message === "string" ? candidate.message : "RGW Admin Ops operation failed.",
    result: candidate.result,
  };
}

function formattedResult(value: unknown): string {
  if (value == null || value === "") return "No response body.";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function CephAdminAdminOpsModal({
  endpointId,
  endpointName,
  action,
  canAccounts = true,
  onClose,
  onSuccess,
}: Props) {
  const [purgeData, setPurgeData] = useState(false);
  const [purgeObjects, setPurgeObjects] = useState(false);
  const [bypassGc, setBypassGc] = useState(false);
  const [fixIndex, setFixIndex] = useState(false);
  const [checkObjects, setCheckObjects] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [linkTargetType, setLinkTargetType] = useState<"user" | "account">("user");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkTargets, setLinkTargets] = useState<LinkTarget[]>([]);
  const [selectedLinkTarget, setSelectedLinkTarget] = useState<LinkTarget | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CephAdminAdminOpsResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const target = useMemo(() => {
    if (action.kind === "delete-account") return action.account.account_id;
    if (action.kind === "delete-user") return userId(action.user);
    return bucketId(action.bucket);
  }, [action]);

  const expectedPhrase = useMemo(() => {
    switch (action.kind) {
      case "delete-account":
        return `DELETE ACCOUNT ${target}`;
      case "delete-user":
        return `${purgeData ? "PURGE" : "DELETE"} USER ${target}`;
      case "delete-bucket":
        return `${purgeObjects ? "PURGE AND DELETE" : "DELETE"} BUCKET ${target}`;
      case "unlink-bucket":
        return `UNLINK BUCKET ${target}`;
      case "link-bucket":
        return selectedLinkTarget ? `LINK BUCKET ${target} TO ${selectedLinkTarget.id}` : "";
      case "index-check":
        return fixIndex ? `FIX BUCKET INDEX ${target}` : "";
    }
  }, [action.kind, fixIndex, purgeData, purgeObjects, selectedLinkTarget, target]);

  const requiresPhrase = action.kind !== "index-check" || fixIndex;
  const title = useMemo(() => {
    switch (action.kind) {
      case "delete-account":
        return "Delete RGW Account";
      case "delete-user":
        return "Delete RGW User";
      case "delete-bucket":
        return "RGW Admin Ops · Delete bucket";
      case "unlink-bucket":
        return "RGW Admin Ops · Unlink bucket";
      case "link-bucket":
        return "RGW Admin Ops · Link bucket";
      case "index-check":
        return "RGW Admin Ops · Check bucket index";
    }
  }, [action.kind]);

  const impact = useMemo(() => {
    switch (action.kind) {
      case "delete-account":
        return "The account is removed only when RGW considers it empty. Users and buckets must be removed first.";
      case "delete-user":
        return purgeData
          ? "RGW removes the user and purges data owned by it. This cannot be undone."
          : "RGW removes the user only when no owned data prevents deletion.";
      case "delete-bucket":
        return purgeObjects
          ? "RGW permanently removes the bucket and all of its objects and versions."
          : "RGW removes the bucket only when it is empty.";
      case "unlink-bucket":
        return "RGW removes the current owner association. The bucket data remains in place.";
      case "link-bucket":
        return "RGW changes the bucket association. This is not a chown and object ACLs are not rewritten.";
      case "index-check":
        return fixIndex
          ? "RGW checks the bucket index and applies repairs."
          : "RGW inspects the bucket index without applying changes.";
    }
  }, [action.kind, fixIndex, purgeData, purgeObjects]);

  useEffect(() => {
    if (action.kind !== "link-bucket") return;
    if (linkTargetType === "account" && !canAccounts) {
      setLinkTargetType("user");
      return;
    }
    let active = true;
    setTargetsLoading(true);
    setTargetsError(null);
    const timer = window.setTimeout(() => {
      const load = async () => {
        try {
          if (linkTargetType === "account") {
            const response = await listCephAdminAccounts(endpointId, {
              page: 1,
              page_size: 25,
              search: linkSearch.trim() || undefined,
              sort_by: "account_id",
              sort_dir: "asc",
            });
            if (!active) return;
            setLinkTargets(
              response.items.map((account) => ({
                type: "account",
                id: account.account_id,
                label: account.account_name ? `${account.account_name} · ${account.account_id}` : account.account_id,
              }))
            );
          } else {
            const response = await listCephAdminUsers(endpointId, {
              page: 1,
              page_size: 25,
              search: linkSearch.trim() || undefined,
              sort_by: "uid",
              sort_dir: "asc",
            });
            if (!active) return;
            setLinkTargets(
              response.items.map((user) => ({
                type: "user",
                id: userId(user),
                label: user.full_name ? `${user.full_name} · ${userId(user)}` : userId(user),
              }))
            );
          }
        } catch (error) {
          if (!active) return;
          setLinkTargets([]);
          setTargetsError(extractApiError(error, "Unable to load RGW link targets."));
        } finally {
          if (active) setTargetsLoading(false);
        }
      };
      void load();
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [action.kind, canAccounts, endpointId, linkSearch, linkTargetType]);

  const resetOutcome = () => {
    setResult(null);
    setRequestError(null);
    setConfirmation("");
  };

  const linkTargetRequired = action.kind === "link-bucket" && !selectedLinkTarget;
  const confirmationMatches = !requiresPhrase || confirmation === expectedPhrase;
  const submitDisabled = submitting || Boolean(result?.success) || linkTargetRequired || !confirmationMatches;

  const run = async () => {
    if (submitDisabled) return;
    setSubmitting(true);
    setRequestError(null);
    setResult(null);
    try {
      let response: CephAdminAdminOpsResult;
      switch (action.kind) {
        case "delete-account":
          response = await deleteCephAdminAccount(endpointId, action.account.account_id, confirmation);
          break;
        case "delete-user":
          response = await deleteCephAdminUser(
            endpointId,
            action.user.uid,
            { confirmation, purge_data: purgeData },
            action.user.tenant
          );
          break;
        case "delete-bucket":
          response = await deleteCephAdminBucket(
            endpointId,
            action.bucket.name,
            { confirmation, purge_objects: purgeObjects, bypass_gc: bypassGc },
            action.bucket.tenant
          );
          break;
        case "unlink-bucket":
          response = await unlinkCephAdminBucket(endpointId, action.bucket.name, confirmation, action.bucket.tenant);
          break;
        case "link-bucket":
          if (!selectedLinkTarget) return;
          response = await linkCephAdminBucket(
            endpointId,
            action.bucket.name,
            {
              confirmation,
              target_type: selectedLinkTarget.type,
              target_id: selectedLinkTarget.id,
            },
            action.bucket.tenant
          );
          break;
        case "index-check":
          response = await checkCephAdminBucketIndex(
            endpointId,
            action.bucket.name,
            { confirmation: confirmation || undefined, fix: fixIndex, check_objects: checkObjects },
            action.bucket.tenant
          );
          break;
      }
      setResult(response);
      if (response.success) onSuccess();
    } catch (error) {
      const structured = structuredResultFromError(error);
      if (structured) {
        setResult(structured);
      } else {
        setRequestError(extractApiError(error, "RGW Admin Ops operation failed."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      maxBodyHeightClass="max-h-[82vh]"
      closeDisabled={submitting}
    >
      <div className="space-y-3" aria-busy={submitting}>
        <InlineSummary items={[
          { label: "Target", value: <span className="break-all font-mono">{target}</span> },
          { label: "Endpoint", value: <span className="break-all">{endpointName || `#${endpointId}`}</span> },
        ]} />

        <UiInlineMessage tone="warning">
          <p className="font-semibold">Impact</p>
          <p className="mt-1">{impact}</p>
        </UiInlineMessage>

        {action.kind === "delete-user" && (
          <ModalOptions>
            <UiCheckboxField
              checked={purgeData}
              disabled={submitting}
              onChange={(event) => {
                setPurgeData(event.target.checked);
                resetOutcome();
              }}
            >
              <span className="modal-option-copy">
                <span className="block font-semibold">Purge owned data</span>
                <span className="modal-option-description">Passes purge-data to RGW. Disabled by default.</span>
              </span>
            </UiCheckboxField>
          </ModalOptions>
        )}

        {action.kind === "delete-bucket" && (
          <div className="space-y-3">
            <ModalOptions>
              <UiCheckboxField
                checked={purgeObjects}
                disabled={submitting}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setPurgeObjects(checked);
                  if (!checked) setBypassGc(false);
                  resetOutcome();
                }}
              >
                <span className="modal-option-copy">
                  <span className="block font-semibold">Purge objects and versions</span>
                  <span className="modal-option-description">Passes purge-objects to RGW. Disabled by default.</span>
                </span>
              </UiCheckboxField>
            </ModalOptions>
            <UiDetails className="modal-disclosure">
              <summary>
                Advanced options
              </summary>
              <ModalOptions className="mt-2">
                <UiCheckboxField
                  checked={bypassGc}
                  disabled={!purgeObjects || submitting}
                  onChange={(event) => {
                    setBypassGc(event.target.checked);
                    resetOutcome();
                  }}
                >
                  <span className="modal-option-copy">
                    <span className="block font-semibold">Bypass garbage collection</span>
                    <span className="modal-option-description">
                      Exceptional recovery option. Ceph strongly recommends normal garbage collection.
                    </span>
                  </span>
                </UiCheckboxField>
              </ModalOptions>
            </UiDetails>
          </div>
        )}

        {action.kind === "index-check" && (
          <ModalOptions>
            <UiCheckboxField
              checked={fixIndex}
              disabled={submitting}
              onChange={(event) => {
                const checked = event.target.checked;
                setFixIndex(checked);
                if (!checked) setCheckObjects(false);
                resetOutcome();
              }}
            >
              <span className="modal-option-copy">
                <span className="block font-semibold">Fix detected index issues</span>
                <span className="modal-option-description">Turns this check into a modifying operation.</span>
              </span>
            </UiCheckboxField>
            <UiCheckboxField
              checked={checkObjects}
              disabled={!fixIndex || submitting}
              onChange={(event) => {
                setCheckObjects(event.target.checked);
                resetOutcome();
              }}
            >
              <span className="modal-option-copy">
                <span className="block font-semibold">Check object state</span>
                <span className="modal-option-description">Ceph requires fix to be enabled first.</span>
              </span>
            </UiCheckboxField>
          </ModalOptions>
        )}

        {action.kind === "link-bucket" && (
          <div className="space-y-3">
            <UiSelect
              label="Target type"
              size="compact"
              disabled={submitting}
              value={linkTargetType}
              hint={canAccounts ? undefined : "RGW Accounts require Ceph Squid or later."}
              onChange={(event) => {
                setLinkTargetType(event.target.value as "user" | "account");
                setSelectedLinkTarget(null);
                setLinkSearch("");
                resetOutcome();
              }}
            >
              <option value="user">RGW Users</option>
              <option value="account" disabled={!canAccounts}>RGW Accounts</option>
            </UiSelect>
            <UiInput
              label="Search targets"
              type="search"
              size="compact"
              disabled={submitting}
              value={linkSearch}
              onChange={(event) => {
                setLinkSearch(event.target.value);
                setSelectedLinkTarget(null);
                resetOutcome();
              }}
              placeholder={linkTargetType === "user" ? "Search RGW Users" : "Search RGW Accounts"}
            />
            <div role="group" aria-label="RGW link targets" className={cx(uiPanelMutedClass, "max-h-44 space-y-1 overflow-y-auto p-2")}>
              {targetsLoading ? (
                <p role="status" className={cx("p-2 ui-caption", uiMutedTextClass)}>Loading targets...</p>
              ) : targetsError ? (
                <UiInlineMessage tone="error" role="alert">{targetsError}</UiInlineMessage>
              ) : linkTargets.length === 0 ? (
                <p className={cx("p-2 ui-caption", uiMutedTextClass)}>No matching target.</p>
              ) : (
                linkTargets.map((candidate) => (
                  <ListActionButton
                    key={`${candidate.type}:${candidate.id}`}
                    type="button"
                    disabled={submitting}
                    aria-pressed={selectedLinkTarget?.id === candidate.id}
                    className={cx("w-full text-left", selectedLinkTarget?.id === candidate.id && "ui-list-action-active")}
                    onClick={() => {
                      setSelectedLinkTarget(candidate);
                      resetOutcome();
                    }}
                  >
                    <span className="min-w-0 flex-1 break-all">{candidate.label}</span>
                  </ListActionButton>
                ))
              )}
            </div>
          </div>
        )}

        {requiresPhrase ? (
          <UiInput
            label="Confirmation phrase"
            size="compact"
            hint={expectedPhrase ? <>Type <code className="whitespace-pre-wrap break-all font-semibold">{expectedPhrase}</code></> : "Select a target before confirming."}
            error={confirmation && expectedPhrase && !confirmationMatches ? "Enter the exact confirmation phrase." : undefined}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={!expectedPhrase || submitting || Boolean(result?.success)}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            This read-only check requires a simple confirmation with the button below.
          </p>
        )}

        {requestError && (
          <UiInlineMessage tone="error" role="alert">
            {requestError}
          </UiInlineMessage>
        )}

        {result && (
          <section
            aria-label="RGW Admin Ops result"
            className="space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ListBadge tone={result.success ? "success" : "danger"}>{result.success ? "Completed" : "Failed"}</ListBadge>
              <InlineSummary items={[
                { label: "RGW HTTP", value: result.rgw_status_code ?? "unavailable" },
                ...(result.rgw_error_code ? [{ label: "Ceph code", value: <span className="break-all">{result.rgw_error_code}</span> }] : []),
              ]} />
            </div>
            <UiInlineMessage tone={result.success ? "success" : "error"} role={result.success ? "status" : "alert"}>{result.message}</UiInlineMessage>
            <pre tabIndex={0} role="region" aria-label="RGW response body" className={cx(uiPanelMutedClass, "max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs")}>
              {formattedResult(result.result)}
            </pre>
          </section>
        )}

        <ModalActions>
          <UiButton variant="secondary" onClick={onClose} disabled={submitting}>
            Close
          </UiButton>
          <UiButton variant={action.kind === "index-check" && !fixIndex ? "primary" : "danger"} onClick={() => void run()} disabled={submitDisabled}>
            {submitting ? "Running..." : result?.success ? "Completed" : result ? "Retry" : action.kind === "index-check" && !fixIndex ? "Run check" : "Run operation"}
          </UiButton>
        </ModalActions>
      </div>
    </Modal>
  );
}
