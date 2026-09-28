/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createManagerMigration,
  getManagerMigration,
  runManagerMigrationPrecheck,
  updateManagerMigration,
  type BucketMigrationCreateRequest,
} from "../../../api/managerMigrations";
import DataTableShell from "../../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../../components/list/listTableStatus";
import SettingsWorkflowForm from "../../../components/settings/SettingsWorkflowForm";
import { SettingsChoiceRow } from "../../../components/settings/SettingsLayout";
import { WorkflowSection } from "../../../components/WorkflowPage";
import UiButton from "../../../components/ui/UiButton";
import UiCheckboxField from "../../../components/ui/UiCheckboxField";
import UiDetails from "../../../components/ui/UiDetails";
import UiInput from "../../../components/ui/UiInput";
import UiSelect from "../../../components/ui/UiSelect";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { useS3AccountContext } from "../S3AccountContext";
import { managerPageBreadcrumbs } from "../managerBreadcrumbs";
import { useManagerContexts } from "../useManagerContexts";
import { useCrossEndpointSelection, useManagerSourceBuckets } from "./hooks";
import { extractError } from "./shared";
import { MigrationStages, targetNameError } from "./MigrationWorkflow";

export default function ManagerMigrationWizardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = /^\d+$/.test(params.get("from") ?? "")
    ? Number(params.get("from"))
    : null;
  const { selectedS3AccountId } = useS3AccountContext();
  const [sourceId, setSourceId] = useState(selectedS3AccountId ?? "");
  const { contexts, contextsLoading, contextsError } = useManagerContexts();
  const { sourceBuckets, bucketsLoading, bucketsError } =
    useManagerSourceBuckets(sourceId);
  const [targetId, setTargetId] = useState("");
  const { sourceBuckets: targetBuckets, bucketsError: targetInventoryError } =
    useManagerSourceBuckets(targetId);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [mode, setMode] = useState<"pre_sync" | "one_shot">("pre_sync");
  const [copySettings, setCopySettings] = useState(false);
  const [lockTarget, setLockTarget] = useState(true);
  const [storageCopy, setStorageCopy] = useState(false);
  const [temporaryGrant, setTemporaryGrant] = useState(false);
  const [revision, setRevision] = useState<number>();
  const [savedId, setSavedId] = useState<number | null>(editId);
  const [loading, setLoading] = useState(Boolean(editId));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const source = contexts.find((entry) => entry.id === sourceId) ?? null;
  const target = contexts.find((entry) => entry.id === targetId) ?? null;
  const crossEndpoint = useCrossEndpointSelection(source, target);
  const contextChanged = Boolean(sourceId && selectedS3AccountId !== sourceId);
  const mappings = selected.map((name) => ({
    source_bucket: name,
    target_bucket: overrides[name] ?? `${prefix}${name}${suffix}`,
  }));
  const errors = new Map(
    mappings.map(({ source_bucket, target_bucket }) => [
      source_bucket,
      targetNameError(target_bucket) ||
        (mappings.filter((entry) => entry.target_bucket === target_bucket)
          .length > 1
          ? "Each destination name must be unique."
          : null) ||
        (targetBuckets.some((bucket) => bucket.name === target_bucket)
          ? "Destination already exists. Choose a new name."
          : null) ||
        (!crossEndpoint && target && target_bucket === source_bucket
          ? "Source and destination names must differ on the same storage."
          : null),
    ]),
  );
  const rows = useMemo(
    () =>
      [
        ...new Set([
          ...sourceBuckets.map((bucket) => bucket.name),
          ...selected,
        ]),
      ].filter((name) => name.toLowerCase().includes(filter.toLowerCase())),
    [sourceBuckets, selected, filter],
  );

  useEffect(() => {
    if (!sourceId && !dirty) setSourceId(selectedS3AccountId ?? "");
  }, [selectedS3AccountId, sourceId, dirty]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!editId) return;
    let canceled = false;
    getManagerMigration(editId)
      .then((detail) => {
        if (canceled) return;
        if (!detail.available_actions?.edit?.enabled)
          throw new Error(
            detail.available_actions?.edit?.reason ??
              "This migration cannot be edited.",
          );
        setSourceId(detail.source_context_id);
        setTargetId(detail.target_context_id);
        setSelected(detail.items.map((item) => item.source_bucket));
        setOverrides(
          Object.fromEntries(
            detail.items.map((item) => [
              item.source_bucket,
              item.target_bucket,
            ]),
          ),
        );
        setMode(detail.mode);
        setCopySettings(detail.copy_bucket_settings);
        setLockTarget(detail.lock_target_writes);
        setStorageCopy(detail.use_same_endpoint_copy);
        setTemporaryGrant(detail.auto_grant_source_read_for_copy);
        setRevision(detail.configuration_revision);
      })
      .catch((failure) => {
        if (!canceled) setError(extractError(failure));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [editId]);

  async function submit() {
    setError(null);
    const problem = !sourceId
      ? "Select a source context."
      : !targetId
        ? "Select a destination context."
        : !selected.length
          ? "Select at least one bucket."
          : [...errors.values()].find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    if (
      source?.kind === "account" &&
      target?.kind === "account" &&
      (source.manager_role !== "account_administrator" ||
        target.manager_role !== "account_administrator")
    ) {
      setError(
        "Cross-account migrations require admin access on both source and target account contexts.",
      );
      return;
    }
    setBusy(true);
    try {
      const payload: BucketMigrationCreateRequest = {
        source_context_id: sourceId,
        target_context_id: targetId,
        buckets: mappings,
        configuration_revision: revision,
        mode,
        copy_bucket_settings: copySettings,
        lock_target_writes: lockTarget,
        use_same_endpoint_copy: storageCopy && !crossEndpoint,
        auto_grant_source_read_for_copy:
          storageCopy && !crossEndpoint && temporaryGrant,
        delete_source: false,
        strong_integrity_check: true,
      };
      const detail = savedId
        ? await updateManagerMigration(savedId, payload)
        : await createManagerMigration(payload);
      setSavedId(detail.id);
      setRevision(detail.configuration_revision);
      setDirty(false);
      await runManagerMigrationPrecheck(detail.id, false);
      flushSync(() => setCompleted(true));
      navigate(`/manager/migrations/${detail.id}`);
    } catch (failure) {
      setError(extractError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsWorkflowForm
      title={editId ? `Edit draft #${editId}` : "New migration"}
      description="Prepare new destination buckets, check the plan, then choose when to copy and cut over."
      breadcrumbs={managerPageBreadcrumbs("migration", { label: "Prepare" })}
      backLabel="Back to migrations"
      width="wide"
      dirty={dirty}
      busy={busy}
      loading={loading || contextsLoading}
      completed={completed}
      disabled={contextChanged || Boolean(editId && !revision)}
      submitLabel="Check migration"
      busyLabel="Saving and queuing checks…"
      onSubmit={submit}
      onClose={(reason) => {
        if (reason !== "navigation") navigate("/manager/migrations");
      }}
    >
      <MigrationStages current={0} />
      <div ref={errorRef} tabIndex={-1} className="outline-none">
        {error && (
          <UiInlineMessage tone="error" role="alert">
            {error}
            {savedId && (
              <>
                {" "}
                Draft #{savedId} is saved.{" "}
                <Link
                  className="underline"
                  to={`/manager/migrations/${savedId}`}
                >
                  Open checks
                </Link>
                .
              </>
            )}
          </UiInlineMessage>
        )}
      </div>
      {contextsError && (
        <UiInlineMessage tone="error">{contextsError}</UiInlineMessage>
      )}
      {contextChanged && (
        <UiInlineMessage tone="warning">
          Your draft still uses {source?.display_name ?? sourceId}. Switch back
          to that source context to continue; your entries are preserved.
        </UiInlineMessage>
      )}
      <fieldset
        disabled={busy || loading || contextChanged}
        className="min-w-0 space-y-6"
        onChange={() => setDirty(true)}
      >
        <WorkflowSection title="Source and destination">
          <div className="grid gap-4 md:grid-cols-2">
            <UiInput
              label="Source context"
              value={source?.display_name ?? sourceId}
              readOnly
            />
            <UiSelect
              label="Destination context"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Select a destination</option>
              {contexts
                .filter(
                  (entry) =>
                    entry.id !== sourceId &&
                    (entry.kind !== "account" ||
                      entry.manager_role === "account_administrator"),
                )
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.display_name} ({entry.id})
                  </option>
                ))}
            </UiSelect>
          </div>
          {targetInventoryError && (
            <UiInlineMessage tone="warning">
              Destination inventory is unavailable. Existing names will be
              checked by the server.
            </UiInlineMessage>
          )}
        </WorkflowSection>
        <WorkflowSection
          title="Buckets and destination names"
          description="Only new destinations are supported. Edit each name here; removing a selection keeps the other mappings."
        >
          <div className="flex flex-wrap items-end gap-3">
            <UiInput
              label="Filter source buckets"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              size="compact"
            />
            <UiButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelected([...new Set([...selected, ...rows])]);
                setDirty(true);
              }}
            >
              Select filtered
            </UiButton>
            <UiButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelected([]);
                setDirty(true);
              }}
            >
              Clear selection
            </UiButton>
            <span className="ui-caption">
              {selected.length} selected / {sourceBuckets.length}
            </span>
          </div>
          <UiDetails>
            <summary className="cursor-pointer ui-caption">
              Optional name prefix and suffix
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <UiInput
                label="Prefix"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
              <UiInput
                label="Suffix"
                value={suffix}
                onChange={(event) => setSuffix(event.target.value)}
              />
            </div>
            <p className="ui-caption mt-2">
              Applies to names that have not been individually edited.
            </p>
          </UiDetails>
          <DataTableShell
            rows={rows}
            rowKey={(name) => name}
            responsiveCards
            tableLayout="fixed"
            status={resolveListTableStatus({
              loading: bucketsLoading,
              error: bucketsError,
              rowCount: rows.length,
            })}
            loadingMessage="Loading buckets…"
            errorMessage={bucketsError ?? "Unable to load buckets."}
            emptyMessage="No matching buckets."
            columns={[
              {
                id: "source",
                label: "Source bucket",
                primary: true,
                render: (name) => (
                  <UiCheckboxField
                    checked={selected.includes(name)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, name]
                          : current.filter((entry) => entry !== name),
                      )
                    }
                    aria-label={`Select ${name}`}
                  >
                    {name}
                  </UiCheckboxField>
                ),
              },
              {
                id: "target",
                label: "New destination",
                render: (name) => (
                  <UiInput
                    aria-label={`Destination name for ${name}`}
                    value={overrides[name] ?? `${prefix}${name}${suffix}`}
                    disabled={!selected.includes(name)}
                    error={errors.get(name)}
                    size="compact"
                    onChange={(event) =>
                      setOverrides((current) => ({
                        ...current,
                        [name]: event.target.value,
                      }))
                    }
                  />
                ),
              },
            ]}
          />
        </WorkflowSection>
        <WorkflowSection
          title="Transfer plan"
          description="Pre-copy runs while the source stays writable. You trigger cutover later, after reviewing the interruption. The source is kept read-only after verification."
        >
          <UiInlineMessage tone="info">
            Read-only checks run first. Tests that temporarily change source
            protections require a separate confirmation. No copy starts from
            this screen.
          </UiInlineMessage>
          <UiDetails>
            <summary className="cursor-pointer ui-caption">
              Advanced options
            </summary>
            <div className="mt-3 space-y-4">
              <fieldset>
                <legend className="ui-caption font-semibold">
                  When to block source writes
                </legend>
                <SettingsChoiceRow
                  type="radio"
                  name="mode"
                  value="pre_sync"
                  title="Pre-copy, then manual cutover"
                  checked={mode === "pre_sync"}
                  onChange={() => setMode("pre_sync")}
                />
                <SettingsChoiceRow
                  type="radio"
                  name="mode"
                  value="one_shot"
                  title="Immediate migration"
                  description="Blocks source writes from the start. You must confirm the interruption before copying."
                  checked={mode === "one_shot"}
                  onChange={() => setMode("one_shot")}
                />
              </fieldset>
              <fieldset>
                <legend className="ui-caption font-semibold">
                  Copy method
                </legend>
                <SettingsChoiceRow
                  type="radio"
                  name="copy"
                  value="stream"
                  title="Copy via BucketReef"
                  checked={!storageCopy || crossEndpoint}
                  onChange={() => setStorageCopy(false)}
                />
                <SettingsChoiceRow
                  type="radio"
                  name="copy"
                  value="storage"
                  title="Copy within storage"
                  description="Requires the same endpoint and destination identity access to the source."
                  disabled={!target || crossEndpoint}
                  checked={storageCopy && !crossEndpoint}
                  onChange={() => setStorageCopy(true)}
                />
              </fieldset>
              <UiCheckboxField
                checked={copySettings}
                onChange={(event) => setCopySettings(event.target.checked)}
              >
                Copy bucket settings
              </UiCheckboxField>
              <p className="ui-caption text-[var(--ui-text-muted)]">
                Optional settings: encryption, lifecycle, CORS, policy, bucket
                tags, public access block and access logging. ACL, website,
                notifications and replication are not copied. Checks list
                unsupported configurations. Object history is preserved even
                when settings copy is off.
              </p>
              <UiCheckboxField
                checked={lockTarget}
                onChange={(event) => setLockTarget(event.target.checked)}
              >
                Protect destination writes during copy
              </UiCheckboxField>
              <UiCheckboxField
                checked={temporaryGrant}
                disabled={!storageCopy || crossEndpoint}
                onChange={(event) => setTemporaryGrant(event.target.checked)}
              >
                Allow temporary source read grants for the destination identity
              </UiCheckboxField>
            </div>
          </UiDetails>
        </WorkflowSection>
      </fieldset>
    </SettingsWorkflowForm>
  );
}
