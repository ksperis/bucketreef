/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createBillingEntity,
  deactivateBillingEntity,
  listBillingEntities,
  previewBillingEntity,
  searchBillingEntitySubjects,
  updateBillingEntity,
  type BillingEntityAdminItem,
  type BillingEntityPayload,
  type BillingEntityRateAssignmentInput,
  type BillingEntityResolution,
  type BillingEntityResolutionResult,
  type BillingEntitySubjectReference,
  type BillingRateCard,
  type BillingSubjectType,
} from "../../api/billing";
import { listAdminTagDefinitions, type TagDefinitionSummary } from "../../api/tags";
import ModalActions from "../../components/ModalActions";
import PageBanner from "../../components/PageBanner";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { UiTagBadge } from "../../components/UiTagSettings";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  SettingsButton,
  SettingsDialog,
  SettingsInput,
  SettingsSelect,
  useSettingsCloseGuard,
} from "../../components/settings/SettingsControls";
import {
  SettingsAutocomplete,
  type SettingsAutocompleteSuggestion,
} from "../../components/settings/SettingsAutocomplete";
import { uiCheckboxClass } from "../../components/ui/styles";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";

type EntityEditor = {
  mode: "create" | "edit";
  entity?: BillingEntityAdminItem;
};

type EntityDraft = {
  name: string;
  code: string;
  externalId: string;
  subjectType: BillingSubjectType;
  includeTagIds: number[];
  explicitIncludes: BillingEntitySubjectReference[];
  explicitExcludes: BillingEntitySubjectReference[];
  rateAssignments: BillingEntityRateAssignmentInput[];
};

type RatePlanOption = {
  id: number;
  name: string;
};

function localIsoDate(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthStart(): string {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function nextMonthStart(): string {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

function emptyDraft(): EntityDraft {
  return {
    name: "",
    code: "",
    externalId: "",
    subjectType: "account",
    includeTagIds: [],
    explicitIncludes: [],
    explicitExcludes: [],
    rateAssignments: [],
  };
}

function draftFromEntity(entity: BillingEntityAdminItem): EntityDraft {
  return {
    name: entity.name,
    code: entity.code ?? "",
    externalId: entity.external_id ?? "",
    subjectType: entity.subject_type,
    includeTagIds: entity.include_tags.map((tag) => tag.id).sort((left, right) => left - right),
    explicitIncludes: [...entity.explicit_includes],
    explicitExcludes: [...entity.explicit_excludes],
    rateAssignments: entity.rate_assignments.map((assignment) => ({
      rate_plan_id: assignment.rate_plan_id,
      effective_from: assignment.effective_from,
      effective_to: assignment.effective_to ?? null,
    })),
  };
}

function draftSignature(draft: EntityDraft): string {
  return JSON.stringify({
    ...draft,
    includeTagIds: [...draft.includeTagIds].sort((left, right) => left - right),
    explicitIncludes: draft.explicitIncludes.map((subject) => subject.subject_id).sort((left, right) => left - right),
    explicitExcludes: draft.explicitExcludes.map((subject) => subject.subject_id).sort((left, right) => left - right),
    rateAssignments: [...draft.rateAssignments]
      .map((assignment) => ({
        ...assignment,
        effective_to: assignment.effective_to || null,
      }))
      .sort((left, right) => left.effective_from.localeCompare(right.effective_from)),
  });
}

function payloadFromDraft(draft: EntityDraft): BillingEntityPayload {
  return {
    name: draft.name.trim(),
    code: draft.code.trim() || null,
    external_id: draft.externalId.trim() || null,
    subject_type: draft.subjectType,
    include_tag_ids: [...draft.includeTagIds].sort((left, right) => left - right),
    explicit_include_ids: draft.explicitIncludes.map((subject) => subject.subject_id).sort((left, right) => left - right),
    explicit_exclude_ids: draft.explicitExcludes.map((subject) => subject.subject_id).sort((left, right) => left - right),
    rate_assignments: draft.rateAssignments
      .map((assignment) => ({
        rate_plan_id: assignment.rate_plan_id,
        effective_from: assignment.effective_from,
        effective_to: assignment.effective_to || null,
      }))
      .sort((left, right) => left.effective_from.localeCompare(right.effective_from)),
  };
}

function isMonthStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value.endsWith("-01");
}

function isMonthEnd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getDate() === new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate();
}

function entityPreview(
  result: BillingEntityResolutionResult | null,
  editor: EntityEditor | null,
  draft: EntityDraft,
): BillingEntityResolution | null {
  if (!result) return null;
  if (editor?.entity) {
    return result.entities.find((entity) => entity.entity_id === editor.entity?.id) ?? null;
  }
  return [...result.entities]
    .reverse()
    .find((entity) => entity.entity_id == null && entity.entity_name === draft.name.trim()) ?? null;
}

function formatReason(
  reason: BillingEntityResolution["members"][number]["reasons"][number],
  text: (message: string) => string,
): string {
  if (reason.kind === "explicit_include") return text("Explicit include");
  if (reason.kind === "explicit_exclude") return text("Explicit exclude");
  return reason.label ? text("Tag") + ": " + reason.label : text("Tag");
}

function SubjectRulePicker({
  label,
  description,
  subjectType,
  subjects,
  onChange,
  disabled,
  text,
}: {
  label: string;
  description: string;
  subjectType: BillingSubjectType;
  subjects: BillingEntitySubjectReference[];
  onChange: (subjects: BillingEntitySubjectReference[]) => void;
  disabled: boolean;
  text: (message: string) => string;
}) {
  const [query, setQuery] = useState("");
  const subjectLookup = useRef(new Map<number, BillingEntitySubjectReference>());

  useEffect(() => {
    setQuery("");
    subjectLookup.current.clear();
  }, [subjectType]);

  const loadSuggestions = useCallback(
    async (search: string): Promise<SettingsAutocompleteSuggestion[]> => {
      const rows = await searchBillingEntitySubjects(subjectType, search, 20);
      for (const row of rows) subjectLookup.current.set(row.subject_id, row);
      const selected = new Set(subjects.map((subject) => subject.subject_id));
      return rows
        .filter((row) => !selected.has(row.subject_id))
        .map((row) => ({
          value: String(row.subject_id),
          label: row.name,
          description: `${row.rgw_identifier} · ${row.storage_endpoint_name}`,
          source: subjectType === "account" ? text("Account") : text("S3 User"),
        }));
    },
    [subjectType, subjects, text],
  );

  const selectSuggestion = (suggestion: SettingsAutocompleteSuggestion) => {
    const subjectId = Number(suggestion.value);
    const subject = subjectLookup.current.get(subjectId);
    if (!subject || subjects.some((item) => item.subject_id === subjectId)) {
      setQuery("");
      return;
    }
    onChange([...subjects, subject]);
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="settings-label">{label}</p>
        <p className="settings-description mt-1">{description}</p>
      </div>
      {subjects.length > 0 ? (
        <div className="space-y-1.5">
          {subjects.map((subject) => (
            <div
              key={subject.subject_id}
              className="flex min-w-0 items-center gap-2 rounded-md border border-[color:var(--ui-border-soft)] px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate ui-caption font-semibold">{subject.name}</p>
                <p className="truncate settings-description">
                  {subject.rgw_identifier} · {subject.storage_endpoint_name}
                </p>
              </div>
              <SettingsButton
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(subjects.filter((item) => item.subject_id !== subject.subject_id))}
                aria-label={text("Remove") + " " + subject.name}
              >
                {text("Remove")}
              </SettingsButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="settings-description">{text("None configured.")}</p>
      )}
      <SettingsAutocomplete
        label={text(subjectType === "account" ? "Add Account" : "Add S3 User")}
        value={query}
        onChange={setQuery}
        onSelectSuggestion={selectSuggestion}
        loadSuggestions={loadSuggestions}
        placeholder={text("Search by name or RGW identifier")}
        loadingLabel={text("Loading suggestions...")}
        disabled={disabled}
        spellCheck={false}
      />
    </div>
  );
}

export default function BillingEntitiesSettingsPanel({ rateCards }: { rateCards: BillingRateCard[] }) {
  const { text } = useAdminI18n();
  const confirmation = useConfirmActionDialog();
  const [entities, setEntities] = useState<BillingEntityAdminItem[]>([]);
  const [tags, setTags] = useState<TagDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editor, setEditor] = useState<EntityEditor | null>(null);
  const [draft, setDraft] = useState<EntityDraft>(emptyDraft);
  const [baselineSignature, setBaselineSignature] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<BillingEntityResolutionResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entityRows, tagRows] = await Promise.all([
        listBillingEntities("", true),
        listAdminTagDefinitions("admin_managed"),
      ]);
      setEntities(entityRows);
      setTags(tagRows);
    } catch (loadError) {
      setError(extractApiError(loadError, text("Unable to load Billing Entities.")));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    void load();
  }, [load]);

  const ratePlans = useMemo<RatePlanOption[]>(() => {
    const seen = new Set<number>();
    const result: RatePlanOption[] = [];
    for (const card of rateCards) {
      if (card.storage_endpoint_id != null || seen.has(card.rate_plan_id)) continue;
      seen.add(card.rate_plan_id);
      result.push({ id: card.rate_plan_id, name: card.name });
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }, [rateCards]);

  const filteredEntities = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return entities.filter((entity) => {
      if (!includeInactive && !entity.active) return false;
      if (!needle) return true;
      return [entity.name, entity.code, entity.external_id]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle));
    });
  }, [entities, includeInactive, search]);

  const validationError = useMemo(() => {
    if (!draft.name.trim()) return text("Name is required.");
    const sortedAssignments = [...draft.rateAssignments].sort((left, right) =>
      left.effective_from.localeCompare(right.effective_from),
    );
    for (const assignment of sortedAssignments) {
      if (!assignment.rate_plan_id) return text("Select a Rate Plan for every assignment.");
      if (!isMonthStart(assignment.effective_from)) {
        return text("Rate Plan assignments must start on the first day of a month.");
      }
      if (assignment.effective_to && !isMonthEnd(assignment.effective_to)) {
        return text("Rate Plan assignments must end on the last day of a month.");
      }
      if (assignment.effective_to && assignment.effective_to < assignment.effective_from) {
        return text("Rate Plan assignment end must not be before its start.");
      }
    }
    for (let index = 1; index < sortedAssignments.length; index += 1) {
      const previous = sortedAssignments[index - 1];
      const current = sortedAssignments[index];
      if (!previous.effective_to || previous.effective_to >= current.effective_from) {
        return text("Rate Plan assignment periods must not overlap.");
      }
    }
    return null;
  }, [draft, text]);

  const dirty = editor != null && draftSignature(draft) !== baselineSignature;
  const closeEditor = () => {
    setEditor(null);
    setPreviewResult(null);
    setPreviewError(null);
    setAttempted(false);
  };
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    onClose: closeEditor,
    disabled: busy || previewBusy,
  });

  const openCreate = () => {
    const next = emptyDraft();
    setDraft(next);
    setBaselineSignature(draftSignature(next));
    setAttempted(false);
    setPreviewResult(null);
    setPreviewError(null);
    setEditor({ mode: "create" });
  };

  const openEdit = (entity: BillingEntityAdminItem) => {
    const next = draftFromEntity(entity);
    setDraft(next);
    setBaselineSignature(draftSignature(next));
    setAttempted(false);
    setPreviewResult(null);
    setPreviewError(null);
    setEditor({ mode: "edit", entity });
  };

  const runPreview = async () => {
    setAttempted(true);
    setPreviewError(null);
    if (validationError) return;
    setPreviewBusy(true);
    try {
      setPreviewResult(await previewBillingEntity(payloadFromDraft(draft), editor?.entity?.id));
    } catch (previewFailure) {
      setPreviewResult(null);
      setPreviewError(extractApiError(previewFailure, text("Unable to preview Billing Entity membership.")));
    } finally {
      setPreviewBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    setMessage(null);
    if (validationError) return;
    setBusy(true);
    try {
      const payload = payloadFromDraft(draft);
      if (editor?.mode === "edit" && editor.entity) {
        await updateBillingEntity(editor.entity.id, payload);
        setMessage(text("Billing Entity updated."));
      } else {
        await createBillingEntity(payload);
        setMessage(text("Billing Entity created."));
      }
      closeEditor();
      await load();
    } catch (saveError) {
      setError(extractApiError(saveError, text("Unable to save Billing Entity.")));
    } finally {
      setBusy(false);
    }
  };

  const requestDeactivate = (entity: BillingEntityAdminItem) => {
    confirmation.requestConfirmation({
      title: text("Deactivate Billing Entity?"),
      description: text("Inactive entities no longer participate in active membership resolution."),
      confirmLabel: text("Deactivate"),
      details: [
        { label: text("Name"), value: entity.name },
        { label: text("Members"), value: String(entity.member_count) },
      ],
      impacts: entity.conflict_count
        ? [text("Deactivation can resolve current cross-entity membership conflicts.")]
        : undefined,
      onConfirm: async () => {
        setBusy(true);
        setError(null);
        try {
          await deactivateBillingEntity(entity.id);
          setMessage(text("Billing Entity deactivated."));
          await load();
        } catch (deactivateError) {
          setError(extractApiError(deactivateError, text("Unable to deactivate Billing Entity.")));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const toggleTag = (tagId: number) => {
    setDraft((current) => ({
      ...current,
      includeTagIds: current.includeTagIds.includes(tagId)
        ? current.includeTagIds.filter((id) => id !== tagId)
        : [...current.includeTagIds, tagId],
    }));
    setPreviewResult(null);
  };

  const setSubjectType = (subjectType: BillingSubjectType) => {
    setDraft((current) => ({
      ...current,
      subjectType,
      explicitIncludes: [],
      explicitExcludes: [],
    }));
    setPreviewResult(null);
  };

  const addRateAssignment = () => {
    const used = new Set(draft.rateAssignments.map((assignment) => assignment.rate_plan_id));
    const plan = ratePlans.find((candidate) => !used.has(candidate.id)) ?? ratePlans[0];
    if (!plan) return;
    setDraft((current) => ({
      ...current,
      rateAssignments: [
        ...current.rateAssignments,
        {
          rate_plan_id: plan.id,
          effective_from: nextMonthStart(),
          effective_to: null,
        },
      ],
    }));
    setPreviewResult(null);
  };

  const updateRateAssignment = (
    index: number,
    updates: Partial<BillingEntityRateAssignmentInput>,
  ) => {
    setDraft((current) => ({
      ...current,
      rateAssignments: current.rateAssignments.map((assignment, assignmentIndex) =>
        assignmentIndex === index ? { ...assignment, ...updates } : assignment,
      ),
    }));
    setPreviewResult(null);
  };

  const removeRateAssignment = (index: number) => {
    setDraft((current) => ({
      ...current,
      rateAssignments: current.rateAssignments.filter((_, assignmentIndex) => assignmentIndex !== index),
    }));
    setPreviewResult(null);
  };

  const columns: Array<DataTableColumn<BillingEntityAdminItem>> = [
    {
      id: "name",
      label: text("Name"),
      primary: true,
      render: (entity) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{entity.name}</p>
          {(entity.code || entity.external_id) && (
            <p className="truncate ui-caption text-[var(--ui-text-muted)]">
              {[entity.code, entity.external_id].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "level",
      label: text("Billing level"),
      render: (entity) => text(entity.subject_type === "account" ? "Accounts" : "S3 Users"),
    },
    {
      id: "rules",
      label: text("Membership rules"),
      render: (entity) =>
        text("{count} tags", { count: entity.include_tags.length }) +
        " · +" + entity.explicit_includes.length +
        " / -" + entity.explicit_excludes.length,
    },
    {
      id: "members",
      label: text("Members"),
      align: "right",
      render: (entity) => entity.member_count,
    },
    {
      id: "conflicts",
      label: text("Conflicts"),
      render: (entity) =>
        entity.conflict_count > 0 ? (
          <ListBadge tone="danger">{text("{count} conflicts", { count: entity.conflict_count })}</ListBadge>
        ) : (
          <ListBadge tone="success">{text("None")}</ListBadge>
        ),
    },
    {
      id: "status",
      label: text("Status"),
      render: (entity) => (
        <ListBadge tone={entity.active ? "success" : "neutral"}>
          {text(entity.active ? "Active" : "Inactive")}
        </ListBadge>
      ),
    },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (entity) => (
        <ListActions>
          <ListActionButton disabled={isDemo || busy} onClick={() => openEdit(entity)}>
            {text("Edit")}
          </ListActionButton>
          {entity.active && (
            <ListActionButton
              variant="danger"
              disabled={isDemo || busy}
              onClick={() => requestDeactivate(entity)}
            >
              {text("Deactivate")}
            </ListActionButton>
          )}
        </ListActions>
      ),
    },
  ];

  const preview = entityPreview(previewResult, editor, draft);
  const relevantConflicts = useMemo(() => {
    if (!previewResult || !editor) return [];
    return previewResult.conflicts.filter((conflict) =>
      conflict.entities.some((entity) =>
        editor.entity
          ? entity.entity_id === editor.entity.id
          : entity.entity_id == null && entity.entity_name === draft.name.trim(),
      ),
    );
  }, [draft.name, editor, previewResult]);

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredEntities.length,
  });

  return (
    <div className="space-y-4">
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <ListPageSection
        variant="page"
        title={text("Billing Entities")}
        description={text("Group Accounts or S3 Users into business entities with explainable membership rules.")}
        countLabel={text(
          filteredEntities.length === 1 ? "{count} entity" : "{count} entities",
          { count: filteredEntities.length },
        )}
        search={
          <ToolbarSearchInput
            value={search}
            onChange={setSearch}
            placeholder={text("Search Billing Entities")}
          />
        }
        filters={
          <label className="flex min-h-8 items-center gap-2 ui-caption text-[var(--ui-text-muted)]">
            <input
              type="checkbox"
              className={uiCheckboxClass}
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            {text("Include inactive")}
          </label>
        }
        actions={
          <ListActions>
            <ListActionButton onClick={() => void load()} loading={loading}>
              {text("Refresh")}
            </ListActionButton>
            <ListActionButton variant="primary" disabled={isDemo || busy} onClick={openCreate}>
              {text("Add Billing Entity")}
            </ListActionButton>
          </ListActions>
        }
      >
        <DataTableShell
          columns={columns}
          rows={filteredEntities}
          rowKey={(entity) => entity.id}
          status={tableStatus}
          loadingMessage={text("Loading Billing Entities...")}
          errorMessage={error ?? text("Unable to load Billing Entities.")}
          emptyMessage={text("No Billing Entities configured.")}
          responsiveCards
        />
      </ListPageSection>

      {editor && (
        <SettingsDialog
          title={text(editor.mode === "edit" ? "Edit Billing Entity" : "Create Billing Entity")}
          onClose={closeGuard.requestClose}
          closeDisabled={busy || previewBusy}
          maxWidthClass="max-w-5xl"
        >
          <form className="settings-stack" onSubmit={save} noValidate>
            <fieldset disabled={isDemo || busy} className="settings-stack">
              <div className="settings-fields sm:grid-cols-2 lg:grid-cols-3">
                <SettingsInput
                  label={text("Name")}
                  value={draft.name}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, name: event.target.value }));
                    setPreviewResult(null);
                  }}
                />
                <SettingsInput
                  label={text("Code")}
                  value={draft.code}
                  onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
                  hint={text("Optional short business code.")}
                />
                <SettingsInput
                  label={text("External ID")}
                  value={draft.externalId}
                  onChange={(event) => setDraft((current) => ({ ...current, externalId: event.target.value }))}
                  hint={text("Optional identifier used by an external billing or cost-center system.")}
                />
              </div>

              <SettingsSelect
                label={text("Billing level")}
                value={draft.subjectType}
                onChange={(event) => setSubjectType(event.target.value as BillingSubjectType)}
                hint={text("An entity resolves either Accounts or S3 Users. The two levels are never mixed.")}
              >
                <option value="account">{text("Accounts")}</option>
                <option value="s3_user">{text("S3 Users")}</option>
              </SettingsSelect>

              <div className="space-y-2">
                <div>
                  <p className="settings-label">{text("Include by Admin-managed tag")}</p>
                  <p className="settings-description mt-1">
                    {text("Subjects matching any selected tag are included before explicit exceptions are applied.")}
                  </p>
                </div>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const selected = draft.includeTagIds.includes(tag.id);
                      return (
                        <UiTagBadge
                          key={tag.id}
                          label={tag.label}
                          colorKey={tag.color_key}
                          selectionState={selected ? "selected" : "available"}
                          disabled={isDemo || busy}
                          ariaLabel={
                            (selected ? text("Remove tag") : text("Include tag")) + " " + tag.label
                          }
                          onClick={() => toggleTag(tag.id)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="settings-description">
                    {text("No Admin-managed tags are available. Explicit membership can still be used.")}
                  </p>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SubjectRulePicker
                  label={text("Explicit includes")}
                  description={text("Always include these subjects even when no selected tag matches.")}
                  subjectType={draft.subjectType}
                  subjects={draft.explicitIncludes}
                  onChange={(subjects) => {
                    setDraft((current) => ({ ...current, explicitIncludes: subjects }));
                    setPreviewResult(null);
                  }}
                  disabled={isDemo || busy}
                  text={text}
                />
                <SubjectRulePicker
                  label={text("Explicit excludes")}
                  description={text("Exclude these subjects last, even when a tag or explicit include matches.")}
                  subjectType={draft.subjectType}
                  subjects={draft.explicitExcludes}
                  onChange={(subjects) => {
                    setDraft((current) => ({ ...current, explicitExcludes: subjects }));
                    setPreviewResult(null);
                  }}
                  disabled={isDemo || busy}
                  text={text}
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="settings-label">{text("Rate Plan assignments")}</p>
                    <p className="settings-description mt-1">
                      {text("Optional global Rate Plan periods. Future changes must use month boundaries.")}
                    </p>
                  </div>
                  <SettingsButton
                    type="button"
                    variant="secondary"
                    size="xs"
                    disabled={isDemo || busy || ratePlans.length === 0}
                    onClick={addRateAssignment}
                  >
                    {text("Add Rate Plan period")}
                  </SettingsButton>
                </div>
                {ratePlans.length === 0 && (
                  <PageBanner tone="warning">
                    {text("Create a global Rate Plan before assigning entity-specific pricing.")}
                  </PageBanner>
                )}
                {draft.rateAssignments.length === 0 ? (
                  <p className="settings-description">{text("No entity Rate Plan assignment configured.")}</p>
                ) : (
                  <div className="space-y-2">
                    {draft.rateAssignments.map((assignment, index) => {
                      const historical = assignment.effective_from < currentMonthStart();
                      return (
                        <div
                          key={`${assignment.rate_plan_id}-${assignment.effective_from}-${index}`}
                          className="grid gap-2 rounded-md border border-[color:var(--ui-border-soft)] p-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] lg:items-end"
                        >
                          <SettingsSelect
                            label={text("Rate Plan")}
                            value={String(assignment.rate_plan_id)}
                            disabled={historical}
                            onChange={(event) =>
                              updateRateAssignment(index, { rate_plan_id: Number(event.target.value) })
                            }
                          >
                            {ratePlans.map((plan) => (
                              <option key={plan.id} value={plan.id}>{plan.name}</option>
                            ))}
                          </SettingsSelect>
                          <SettingsInput
                            label={text("Effective from")}
                            type="date"
                            value={assignment.effective_from}
                            disabled={historical}
                            onChange={(event) =>
                              updateRateAssignment(index, { effective_from: event.target.value })
                            }
                          />
                          <SettingsInput
                            label={text("Effective to")}
                            type="date"
                            value={assignment.effective_to ?? ""}
                            disabled={historical}
                            onChange={(event) =>
                              updateRateAssignment(index, { effective_to: event.target.value || null })
                            }
                          />
                          {historical ? (
                            <ListBadge tone="neutral">{text("Historical")}</ListBadge>
                          ) : (
                            <SettingsButton
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => removeRateAssignment(index)}
                            >
                              {text("Remove")}
                            </SettingsButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="settings-label">{text("Membership preview")}</p>
                    <p className="settings-description mt-1">
                      {text("Preview uses the canonical backend resolver and includes cross-entity conflicts.")}
                    </p>
                  </div>
                  <SettingsButton
                    type="button"
                    variant="secondary"
                    disabled={isDemo || busy || previewBusy}
                    loading={previewBusy}
                    onClick={() => void runPreview()}
                  >
                    {previewBusy ? text("Previewing...") : text("Preview membership")}
                  </SettingsButton>
                </div>
                {previewError && <PageBanner tone="error">{previewError}</PageBanner>}
                {relevantConflicts.length > 0 && (
                  <PageBanner tone="error">
                    {text(
                      relevantConflicts.length === 1
                        ? "{count} subject would belong to multiple active Billing Entities."
                        : "{count} subjects would belong to multiple active Billing Entities.",
                      { count: relevantConflicts.length },
                    )}
                  </PageBanner>
                )}
                {preview && (
                  <div className="space-y-3 rounded-md border border-[color:var(--ui-border-soft)] p-3">
                    <div className="flex flex-wrap gap-2">
                      <ListBadge tone="success">
                        {text("{count} resolved members", { count: preview.members.length })}
                      </ListBadge>
                      <ListBadge tone="neutral">
                        {text("{count} explicit exclusions", { count: preview.excluded.length })}
                      </ListBadge>
                      <ListBadge tone="neutral">
                        {text("{count} unassigned subjects", {
                          count: previewResult?.unassigned.filter(
                            (subject) => subject.subject_type === draft.subjectType,
                          ).length ?? 0,
                        })}
                      </ListBadge>
                    </div>

                    {preview.members.length === 0 ? (
                      <p className="settings-description">{text("No subjects currently resolve to this entity.")}</p>
                    ) : (
                      <div className="max-h-64 space-y-1.5 overflow-y-auto">
                        {preview.members.map((subject) => (
                          <div
                            key={subject.subject_id}
                            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--ui-hover)] px-2 py-1.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate ui-caption font-semibold">{subject.name}</p>
                              <p className="truncate settings-description">
                                {subject.rgw_identifier} · {subject.storage_endpoint_name}
                              </p>
                            </div>
                            <span className="ui-caption text-[var(--ui-text-muted)]">
                              {subject.reasons.map((reason) => formatReason(reason, text)).join(" · ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {preview.excluded.length > 0 && (
                      <div>
                        <p className="settings-label mb-1">{text("Excluded matches")}</p>
                        <div className="max-h-40 space-y-1 overflow-y-auto">
                          {preview.excluded.map((subject) => (
                            <div key={subject.subject_id} className="flex flex-wrap justify-between gap-2 ui-caption">
                              <span>{subject.name}</span>
                              <span className="text-[var(--ui-text-muted)]">
                                {subject.reasons.map((reason) => formatReason(reason, text)).join(" · ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {relevantConflicts.length > 0 && (
                      <div>
                        <p className="settings-label mb-1 text-rose-700 dark:text-rose-300">
                          {text("Conflicting subjects")}
                        </p>
                        <div className="space-y-1">
                          {relevantConflicts.map((conflict) => (
                            <p key={conflict.subject.subject_id} className="ui-caption">
                              <span className="font-semibold">{conflict.subject.name}</span>
                              {" · "}
                              {conflict.entities.map((entity) => entity.entity_name).join(", ")}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </fieldset>

            {attempted && validationError && <PageBanner tone="error">{validationError}</PageBanner>}
            <ModalActions>
              <SettingsButton type="button" variant="secondary" disabled={busy} onClick={closeGuard.requestClose}>
                {text("Cancel")}
              </SettingsButton>
              <SettingsButton type="submit" disabled={isDemo || busy}>
                {busy ? text("Saving...") : text("Save")}
              </SettingsButton>
            </ModalActions>
          </form>
        </SettingsDialog>
      )}

      {confirmation.confirmationDialog}
      {closeGuard.confirmationDialog}
    </div>
  );
}
