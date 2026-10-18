/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createBillingEntityGroup,
  deactivateBillingEntityGroup,
  listBillingEntities,
  listBillingEntityGroups,
  updateBillingEntityGroup,
  type BillingEntityAdminItem,
  type BillingEntityGroupAdminItem,
  type BillingEntityGroupMembershipInput,
  type BillingEntityGroupPayload,
} from "../../api/billing";
import ModalActions from "../../components/ModalActions";
import PageBanner from "../../components/PageBanner";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
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
import UiTextarea from "../../components/ui/UiTextarea";
import { uiCheckboxClass } from "../../components/ui/styles";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { useAdminI18n } from "./adminI18n";

const isDemo = import.meta.env.MODE === "demo";

type GroupEditor = {
  mode: "create" | "edit";
  group?: BillingEntityGroupAdminItem;
};

type GroupDraft = {
  name: string;
  code: string;
  externalId: string;
  description: string;
  memberships: BillingEntityGroupMembershipInput[];
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

function emptyDraft(): GroupDraft {
  return {
    name: "",
    code: "",
    externalId: "",
    description: "",
    memberships: [],
  };
}

function draftFromGroup(group: BillingEntityGroupAdminItem): GroupDraft {
  return {
    name: group.name,
    code: group.code ?? "",
    externalId: group.external_id ?? "",
    description: group.description ?? "",
    memberships: group.memberships.map((membership) => ({
      billing_entity_id: membership.billing_entity_id,
      effective_from: membership.effective_from,
      effective_to: membership.effective_to ?? null,
    })),
  };
}

function normalizedMemberships(memberships: BillingEntityGroupMembershipInput[]) {
  return [...memberships]
    .map((membership) => ({
      ...membership,
      effective_to: membership.effective_to || null,
    }))
    .sort((left, right) =>
      `${left.billing_entity_id}-${left.effective_from}`.localeCompare(
        `${right.billing_entity_id}-${right.effective_from}`,
      ),
    );
}

function draftSignature(draft: GroupDraft): string {
  return JSON.stringify({ ...draft, memberships: normalizedMemberships(draft.memberships) });
}

function payloadFromDraft(draft: GroupDraft): BillingEntityGroupPayload {
  return {
    name: draft.name.trim(),
    code: draft.code.trim() || null,
    external_id: draft.externalId.trim() || null,
    description: draft.description.trim() || null,
    memberships: normalizedMemberships(draft.memberships),
  };
}

function isMonthStart(value: string): boolean {
  return /^\d{4}-\d{2}-01$/.test(value);
}

function isMonthEnd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getDate() === new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate();
}

function membershipStatus(membership: BillingEntityGroupMembershipInput): "historical" | "current" | "future" {
  const current = currentMonthStart();
  if (membership.effective_from > current) return "future";
  if (membership.effective_to && membership.effective_to < current) return "historical";
  return "current";
}

export default function BillingGroupsSettingsPanel() {
  const { text } = useAdminI18n();
  const confirmation = useConfirmActionDialog();
  const [groups, setGroups] = useState<BillingEntityGroupAdminItem[]>([]);
  const [entities, setEntities] = useState<BillingEntityAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editor, setEditor] = useState<GroupEditor | null>(null);
  const [draft, setDraft] = useState<GroupDraft>(emptyDraft);
  const [baselineSignature, setBaselineSignature] = useState("");
  const [attempted, setAttempted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupRows, entityRows] = await Promise.all([
        listBillingEntityGroups("", true),
        listBillingEntities("", true),
      ]);
      setGroups(groupRows);
      setEntities(entityRows);
    } catch (loadError) {
      setError(extractApiError(loadError, text("Unable to load Billing Groups.")));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return groups.filter((group) => {
      if (!includeInactive && !group.active) return false;
      if (!needle) return true;
      return [group.name, group.code, group.external_id, group.description]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle));
    });
  }, [groups, includeInactive, search]);

  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );

  const validationError = useMemo(() => {
    if (!draft.name.trim()) return text("Name is required.");
    const byEntity = new Map<number, BillingEntityGroupMembershipInput[]>();
    for (const membership of draft.memberships) {
      if (!entityById.has(membership.billing_entity_id)) return text("Select a Billing Entity for every membership.");
      if (!isMonthStart(membership.effective_from)) {
        return text("Group memberships must start on the first day of a month.");
      }
      if (membership.effective_to && !isMonthEnd(membership.effective_to)) {
        return text("Group memberships must end on the last day of a month.");
      }
      if (membership.effective_to && membership.effective_to < membership.effective_from) {
        return text("Group membership end must not be before its start.");
      }
      const rows = byEntity.get(membership.billing_entity_id) ?? [];
      rows.push(membership);
      byEntity.set(membership.billing_entity_id, rows);
    }
    for (const memberships of byEntity.values()) {
      const ordered = [...memberships].sort((left, right) => left.effective_from.localeCompare(right.effective_from));
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        if (!previous.effective_to || previous.effective_to >= current.effective_from) {
          return text("Group membership periods for the same entity must not overlap.");
        }
      }
    }
    return null;
  }, [draft, entityById, text]);

  const dirty = editor != null && draftSignature(draft) !== baselineSignature;
  const closeEditor = useCallback(() => {
    setEditor(null);
    setAttempted(false);
  }, []);
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges: dirty,
    onClose: closeEditor,
    disabled: busy,
  });

  const openCreate = () => {
    const next = emptyDraft();
    setDraft(next);
    setBaselineSignature(draftSignature(next));
    setAttempted(false);
    setEditor({ mode: "create" });
  };

  const openEdit = (group: BillingEntityGroupAdminItem) => {
    const next = draftFromGroup(group);
    setDraft(next);
    setBaselineSignature(draftSignature(next));
    setAttempted(false);
    setEditor({ mode: "edit", group });
  };

  const addMembership = () => {
    const entity = entities.find((item) => item.active) ?? entities[0];
    if (!entity) return;
    setDraft((current) => ({
      ...current,
      memberships: [
        ...current.memberships,
        {
          billing_entity_id: entity.id,
          effective_from: currentMonthStart(),
          effective_to: null,
        },
      ],
    }));
  };

  const updateMembership = (index: number, updates: Partial<BillingEntityGroupMembershipInput>) => {
    setDraft((current) => ({
      ...current,
      memberships: current.memberships.map((membership, membershipIndex) =>
        membershipIndex === index ? { ...membership, ...updates } : membership,
      ),
    }));
  };

  const removeMembership = (index: number) => {
    setDraft((current) => ({
      ...current,
      memberships: current.memberships.filter((_, membershipIndex) => membershipIndex !== index),
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    setMessage(null);
    if (!editor || validationError || busy) return;
    setBusy(true);
    try {
      const payload = payloadFromDraft(draft);
      if (editor.mode === "edit" && editor.group) {
        await updateBillingEntityGroup(editor.group.id, payload);
        setMessage(text("Billing Group updated."));
      } else {
        await createBillingEntityGroup(payload);
        setMessage(text("Billing Group created."));
      }
      closeEditor();
      await load();
    } catch (saveError) {
      setError(extractApiError(saveError, text("Unable to save Billing Group.")));
    } finally {
      setBusy(false);
    }
  };

  const requestDeactivate = (group: BillingEntityGroupAdminItem) => {
    confirmation.requestConfirmation({
      title: text("Deactivate Billing Group?"),
      description: text("Inactive groups remain available for historical analysis but are hidden from active group lists."),
      confirmLabel: text("Deactivate"),
      details: [
        { label: text("Name"), value: group.name },
        { label: text("Current members"), value: String(group.current_member_count) },
      ],
      onConfirm: async () => {
        setBusy(true);
        setError(null);
        try {
          await deactivateBillingEntityGroup(group.id);
          setMessage(text("Billing Group deactivated."));
          await load();
        } catch (deactivateError) {
          setError(extractApiError(deactivateError, text("Unable to deactivate Billing Group.")));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const columns: Array<DataTableColumn<BillingEntityGroupAdminItem>> = [
    {
      id: "name",
      label: text("Name"),
      primary: true,
      render: (group) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{group.name}</p>
          {(group.code || group.external_id) && (
            <p className="truncate ui-caption text-[var(--ui-text-muted)]">
              {[group.code, group.external_id].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "current",
      label: text("Current members"),
      align: "right",
      render: (group) => group.current_member_count,
    },
    {
      id: "scheduled",
      label: text("Scheduled changes"),
      render: (group) =>
        group.scheduled_membership_count > 0 ? (
          <ListBadge tone="warning">
            {text("{count} scheduled", { count: group.scheduled_membership_count })}
          </ListBadge>
        ) : (
          <ListBadge tone="neutral">{text("None")}</ListBadge>
        ),
    },
    {
      id: "status",
      label: text("Status"),
      render: (group) => (
        <ListBadge tone={group.active ? "success" : "neutral"}>
          {text(group.active ? "Active" : "Inactive")}
        </ListBadge>
      ),
    },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (group) => (
        <ListActions>
          <ListActionButton disabled={isDemo || busy} onClick={() => openEdit(group)}>
            {text("Edit")}
          </ListActionButton>
          {group.active && (
            <ListActionButton
              variant="danger"
              disabled={isDemo || busy}
              onClick={() => requestDeactivate(group)}
            >
              {text("Deactivate")}
            </ListActionButton>
          )}
        </ListActions>
      ),
    },
  ];

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: filteredGroups.length });

  return (
    <div className="space-y-4">
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <ListPageSection
        variant="page"
        title={text("Billing Groups")}
        description={text("Aggregate Billing Entities into historized analytical scopes without changing billing allocation.")}
        countLabel={text(
          filteredGroups.length === 1 ? "{count} group" : "{count} groups",
          { count: filteredGroups.length },
        )}
        search={
          <ToolbarSearchInput
            value={search}
            onChange={setSearch}
            placeholder={text("Search Billing Groups")}
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
              {text("Add Billing Group")}
            </ListActionButton>
          </ListActions>
        }
      >
        <DataTableShell
          columns={columns}
          rows={filteredGroups}
          rowKey={(group) => group.id}
          status={tableStatus}
          loadingMessage={text("Loading Billing Groups...")}
          errorMessage={error ?? text("Unable to load Billing Groups.")}
          emptyMessage={text("No Billing Groups configured.")}
          responsiveCards
        />
      </ListPageSection>

      {editor && (
        <SettingsDialog
          title={text(editor.mode === "edit" ? "Edit Billing Group" : "Create Billing Group")}
          onClose={closeGuard.requestClose}
          closeDisabled={busy}
          maxWidthClass="max-w-5xl"
        >
          <form className="settings-stack" onSubmit={save} noValidate>
            <fieldset disabled={isDemo || busy} className="settings-stack">
              <div className="settings-fields sm:grid-cols-2 lg:grid-cols-3">
                <SettingsInput
                  label={text("Name")}
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
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
                  hint={text("Optional identifier used by an external reporting or cost-center system.")}
                />
              </div>

              <UiTextarea
                label={text("Description")}
                value={draft.description}
                rows={3}
                className="settings-control"
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                hint={text("Optional organizational context for this analytical group.")}
              />

              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="settings-label">{text("Billing Entity memberships")}</p>
                    <p className="settings-description mt-1">
                      {text("Memberships are explicit and month-aligned so organizational history remains explainable.")}
                    </p>
                  </div>
                  <SettingsButton
                    type="button"
                    variant="secondary"
                    size="xs"
                    disabled={entities.length === 0}
                    onClick={addMembership}
                  >
                    {text("Add membership period")}
                  </SettingsButton>
                </div>

                {entities.length === 0 && (
                  <PageBanner tone="warning">
                    {text("Create a Billing Entity before adding it to an analytical group.")}
                  </PageBanner>
                )}

                {draft.memberships.length === 0 ? (
                  <p className="settings-description">{text("No Billing Entity membership configured.")}</p>
                ) : (
                  <div className="space-y-2">
                    {draft.memberships.map((membership, index) => {
                      const status = membershipStatus(membership);
                      const entity = entityById.get(membership.billing_entity_id);
                      return (
                        <div
                          key={`${membership.billing_entity_id}-${membership.effective_from}-${index}`}
                          className="grid gap-2 rounded-md border border-[color:var(--ui-border-soft)] p-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_auto_auto] lg:items-end"
                        >
                          <SettingsSelect
                            label={text("Billing Entity")}
                            value={String(membership.billing_entity_id)}
                            onChange={(event) =>
                              updateMembership(index, { billing_entity_id: Number(event.target.value) })
                            }
                          >
                            {entities.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name}{candidate.active ? "" : ` (${text("Inactive")})`}
                              </option>
                            ))}
                          </SettingsSelect>
                          <SettingsInput
                            label={text("Effective from")}
                            type="date"
                            value={membership.effective_from}
                            onChange={(event) => updateMembership(index, { effective_from: event.target.value })}
                          />
                          <SettingsInput
                            label={text("Effective to")}
                            type="date"
                            value={membership.effective_to ?? ""}
                            onChange={(event) => updateMembership(index, { effective_to: event.target.value || null })}
                            hint={text("Optional. Use the last day of a month.")}
                          />
                          <ListBadge tone={status === "future" ? "warning" : status === "current" ? "success" : "neutral"}>
                            {text(status === "future" ? "Scheduled" : status === "current" ? "Current" : "Historical")}
                          </ListBadge>
                          <SettingsButton type="button" variant="ghost" size="xs" onClick={() => removeMembership(index)}>
                            {text("Remove")}
                          </SettingsButton>
                          {entity && !entity.active && (
                            <p className="lg:col-span-5 settings-description">
                              {text("This Billing Entity is inactive; its membership is retained for historical analysis.")}
                            </p>
                          )}
                        </div>
                      );
                    })}
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
