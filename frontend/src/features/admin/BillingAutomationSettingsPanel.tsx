/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getBillingAutomationSettings,
  listBillingAutomationRuns,
  updateBillingAutomationSettings,
  type BillingAutomationRun,
  type BillingAutomationSettings,
} from "../../api/billing";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { SettingsButton, SettingsInput, SettingsSelect } from "../../components/settings/SettingsControls";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { extractApiError } from "../../utils/apiError";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";

function modeLabel(mode: BillingAutomationSettings["mode"]): string {
  if (mode === "automatic_draft") return "Automatic draft, manual finalization";
  if (mode === "automatic_finalize") return "Automatic draft and finalization";
  return "Manual generation and finalization";
}

function runModeLabel(mode: BillingAutomationRun["mode"]): string {
  return mode === "automatic_finalize" ? "Draft + finalize" : "Draft only";
}

function statusTone(status: BillingAutomationRun["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "partial") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function draftSignature(settings: BillingAutomationSettings): string {
  return JSON.stringify(settings);
}

export default function BillingAutomationSettingsPanel() {
  const { text } = useAdminI18n();
  const [draft, setDraft] = useState<BillingAutomationSettings | null>(null);
  const [baseline, setBaseline] = useState<BillingAutomationSettings | null>(null);
  const [runs, setRuns] = useState<BillingAutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, history] = await Promise.all([
        getBillingAutomationSettings(),
        listBillingAutomationRuns(),
      ]);
      setDraft(settings);
      setBaseline(settings);
      setRuns(history);
    } catch (loadError) {
      setError(extractApiError(loadError, text("Unable to load Billing automation settings.")));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = Boolean(draft && baseline && draftSignature(draft) !== draftSignature(baseline));

  const save = useCallback(async () => {
    if (!draft || isDemo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await updateBillingAutomationSettings(draft);
      setDraft(saved);
      setBaseline(saved);
      setMessage(text("Billing automation settings saved."));
    } catch (saveError) {
      setError(extractApiError(saveError, text("Unable to save Billing automation settings.")));
    } finally {
      setSaving(false);
    }
  }, [draft, text]);

  const columns = useMemo<Array<DataTableColumn<BillingAutomationRun>>>(() => [
    {
      id: "month",
      label: text("Month"),
      primary: true,
      render: (run) => run.month,
    },
    {
      id: "mode",
      label: text("Mode"),
      render: (run) => text(runModeLabel(run.mode)),
    },
    {
      id: "status",
      label: text("Status"),
      render: (run) => <ListBadge tone={statusTone(run.status)}>{text(run.status)}</ListBadge>,
    },
    {
      id: "statements",
      label: text("Statements"),
      render: (run) => (
        <span>
          {text("{generated} generated · {finalized} finalized", {
            generated: run.generated_statement_count,
            finalized: run.finalized_statement_count,
          })}
        </span>
      ),
    },
    {
      id: "issues",
      label: text("Issues"),
      render: (run) => (
        run.blocked_statement_count || run.failed_entity_count || run.unassigned_subject_count
          ? text("{blocked} blocked · {failed} failed · {unassigned} unassigned", {
              blocked: run.blocked_statement_count,
              failed: run.failed_entity_count,
              unassigned: run.unassigned_subject_count,
            })
          : text("None")
      ),
    },
    {
      id: "started",
      label: text("Started"),
      render: (run) => new Date(run.started_at).toLocaleString(),
    },
  ], [text]);

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: runs.length });

  return (
    <div className="space-y-4">
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <ListPageSection
        variant="section"
        title={text("Monthly statement automation")}
        description={text("Choose how completed months become Billing Statements. Safety gates always use the same validation as manual finalization.")}
      >
        {draft && (
          <div className="settings-stack p-4">
            <div className="settings-fields sm:grid-cols-2">
              <SettingsSelect
                label={text("Workflow")}
                value={draft.mode}
                disabled={isDemo || saving}
                onChange={(event) => setDraft((current) => current && ({
                  ...current,
                  mode: event.target.value as BillingAutomationSettings["mode"],
                }))}
              >
                <option value="manual">{text(modeLabel("manual"))}</option>
                <option value="automatic_draft">{text(modeLabel("automatic_draft"))}</option>
                <option value="automatic_finalize">{text(modeLabel("automatic_finalize"))}</option>
              </SettingsSelect>
              <SettingsInput
                label={text("Run on day of month")}
                type="number"
                min={1}
                max={28}
                value={draft.schedule_day}
                disabled={isDemo || saving || draft.mode === "manual"}
                onChange={(event) => setDraft((current) => current && ({
                  ...current,
                  schedule_day: Math.min(28, Math.max(1, Number(event.target.value) || 1)),
                }))}
              />
            </div>

            <UiCheckboxField
              checked={draft.require_all_subjects_assigned}
              disabled={isDemo || saving || draft.mode !== "automatic_finalize"}
              onChange={(event) => setDraft((current) => current && ({
                ...current,
                require_all_subjects_assigned: event.target.checked,
              }))}
              className="settings-choice"
            >
              <span>
                <span className="block font-medium">{text("Require every Billing subject to be assigned")}</span>
                <span className="block text-sm text-[var(--ui-text-muted)]">
                  {text("When enabled, automatic finalization stops if an Account or S3 User is outside every active Billing Entity.")}
                </span>
              </span>
            </UiCheckboxField>

            <div className="rounded-lg border border-[var(--ui-border)] p-3 text-sm text-[var(--ui-text-muted)]">
              {text("Automatic finalization always requires complete storage and usage coverage, complete historical quota coverage for allocated-quota lines, resolved membership and pricing, and the canonical statement finalization checks. These gates cannot be relaxed here.")}
            </div>

            {dirty && (
              <div className="flex flex-wrap justify-end gap-2">
                <SettingsButton
                  variant="secondary"
                  disabled={saving}
                  onClick={() => baseline && setDraft(baseline)}
                >
                  {text("Cancel")}
                </SettingsButton>
                <SettingsButton disabled={saving || isDemo} loading={saving} onClick={() => void save()}>
                  {text("Save changes")}
                </SettingsButton>
              </div>
            )}
          </div>
        )}
      </ListPageSection>

      <ListPageSection
        variant="section"
        title={text("Recent automation runs")}
        countLabel={text(runs.length === 1 ? "{count} run" : "{count} runs", { count: runs.length })}
        actions={
          <ListActions>
            <ListActionButton onClick={() => void load()} loading={loading}>
              {text("Refresh")}
            </ListActionButton>
          </ListActions>
        }
      >
        <DataTableShell
          columns={columns}
          rows={runs}
          rowKey={(run) => run.id}
          status={tableStatus}
          loadingMessage={text("Loading Billing automation runs...")}
          errorMessage={error ?? text("Unable to load Billing automation runs.")}
          emptyMessage={text("No Billing automation run has been recorded yet.")}
          responsiveCards
        />
      </ListPageSection>
    </div>
  );
}
