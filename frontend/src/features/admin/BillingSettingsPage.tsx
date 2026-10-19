/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createBillingRateCard,
  createBillingRateCardVersion,
  deleteBillingRateCard,
  listBillingRateCards,
  updateBillingRateCard,
  type BillingRateCard,
  type BillingRateCardPayload,
} from "../../api/billing";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import ModalActions from "../../components/ModalActions";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton, ListActions, ListBadge } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  SettingsButton,
  SettingsDialog,
  useSettingsCloseGuard,
} from "../../components/settings/SettingsControls";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useAdminI18n } from "./adminI18n";
import BillingEntitiesSettingsPanel from "./BillingEntitiesSettingsPanel";
import BillingGroupsSettingsPanel from "./BillingGroupsSettingsPanel";
import BillingAutomationSettingsPanel from "./BillingAutomationSettingsPanel";
import BillingStatementPdfSettingsPanel from "./BillingStatementPdfSettingsPanel";

const isDemo = import.meta.env.MODE === "demo";

type EditorMode = "create" | "edit" | "version";
type BillingSettingsTab = "pricing" | "entities" | "groups" | "automation" | "pdf";

type Draft = {
  name: string;
  scope: "global" | "endpoint";
  endpointId: string;
  currency: string;
  storageChargeBasis: "actual_usage" | "allocated_quota";
  storage: string;
  egress: string;
  ingress: string;
  requests: string;
  effectiveFrom: string;
  effectiveTo: string;
};

function localIsoDate(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function nextMonthStart(): string {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

function emptyDraft(): Draft {
  return {
    name: "default",
    scope: "global",
    endpointId: "",
    currency: "EUR",
    storageChargeBasis: "actual_usage",
    storage: "",
    egress: "",
    ingress: "",
    requests: "",
    effectiveFrom: nextMonthStart(),
    effectiveTo: "",
  };
}

function draftFromCard(card: BillingRateCard, mode: EditorMode): Draft {
  return {
    name: card.name,
    scope: card.storage_endpoint_id == null ? "global" : "endpoint",
    endpointId: card.storage_endpoint_id == null ? "" : String(card.storage_endpoint_id),
    currency: card.currency,
    storageChargeBasis: card.storage_charge_basis,
    storage: card.storage_gb_month_price == null ? "" : String(card.storage_gb_month_price),
    egress: card.egress_gb_price == null ? "" : String(card.egress_gb_price),
    ingress: card.ingress_gb_price == null ? "" : String(card.ingress_gb_price),
    requests: card.requests_per_1000_price == null ? "" : String(card.requests_per_1000_price),
    effectiveFrom: mode === "version" ? nextMonthStart() : card.effective_from,
    effectiveTo: mode === "version" ? "" : card.effective_to ?? "",
  };
}

function parsePrice(value: string): string | null {
  return value.trim() || null;
}

function statusTone(status: BillingRateCard["status"]): "success" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "future") return "warning";
  return "neutral";
}

export default function BillingSettingsPage() {
  const { text: adminText } = useAdminI18n();
  const breadcrumbs = useAdminPageBreadcrumbs();
  const confirmation = useConfirmActionDialog();
  const [activeTab, setActiveTab] = useState<BillingSettingsTab>("pricing");
  const [pdfDirty, setPdfDirty] = useState(false);
  const pendingTab = useRef<BillingSettingsTab | null>(null);
  const [cards, setCards] = useState<BillingRateCard[]>([]);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: EditorMode; card?: BillingRateCard } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baselineDraft, setBaselineDraft] = useState<Draft | null>(null);
  const [attempted, setAttempted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rateCards, endpointRows] = await Promise.all([
        listBillingRateCards(),
        listStorageEndpoints(),
      ]);
      setCards(rateCards);
      setEndpoints(endpointRows);
    } catch (loadError) {
      setError(extractApiError(loadError, adminText("Unable to load billing rate cards.")));
    } finally {
      setLoading(false);
    }
  }, [adminText]);

  useEffect(() => {
    void load();
  }, [load]);

  const validationError = useMemo(() => {
    if (!draft.name.trim()) return adminText("Name is required.");
    if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) {
      return adminText("Currency must be a 3-letter ISO code.");
    }
    if (draft.scope === "endpoint" && !draft.endpointId) return adminText("Select an S3 endpoint.");
    const prices = [draft.storage, draft.egress, draft.ingress, draft.requests];
    if (prices.every((value) => !value.trim())) return adminText("Configure at least one price.");
    if (prices.some((value) => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      return adminText("Prices must be positive numbers or zero.");
    }
    if (!draft.effectiveFrom) return adminText("Effective from is required.");
    const start = new Date(draft.effectiveFrom + "T00:00:00");
    if (start.getDate() !== 1) return adminText("Effective from must be the first day of a month.");
    if (draft.effectiveTo) {
      const end = new Date(draft.effectiveTo + "T00:00:00");
      const last = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
      if (end.getDate() !== last) return adminText("Effective to must be the last day of a month.");
      if (end < start) return adminText("Effective to must not be before Effective from.");
    }
    return null;
  }, [adminText, draft]);

  const openCreate = () => {
    const nextDraft = emptyDraft();
    setAttempted(false);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setEditor({ mode: "create" });
  };

  const openEdit = (card: BillingRateCard) => {
    const nextDraft = draftFromCard(card, "edit");
    setAttempted(false);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setEditor({ mode: "edit", card });
  };

  const openVersion = (card: BillingRateCard) => {
    const nextDraft = draftFromCard(card, "version");
    setAttempted(false);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setEditor({ mode: "version", card });
  };

  const closeEditor = useCallback(() => {
    setEditor(null);
    setBaselineDraft(null);
    setAttempted(false);
  }, []);

  const editorDirty = useMemo(
    () => Boolean(editor && baselineDraft && JSON.stringify(draft) !== JSON.stringify(baselineDraft)),
    [baselineDraft, draft, editor],
  );
  const closeGuard = useSettingsCloseGuard({
    hasUnsavedChanges: editorDirty,
    disabled: busy,
    onClose: closeEditor,
    title: adminText("Discard changes?"),
    description: adminText("You have unapplied changes. Closing this dialog will discard them."),
    confirmLabel: adminText("Discard changes"),
    cancelLabel: adminText("Keep editing"),
  });
  const pdfTabCloseGuard = useSettingsCloseGuard({
    hasUnsavedChanges: activeTab === "pdf" && pdfDirty,
    onClose: () => {
      const nextTab = pendingTab.current;
      pendingTab.current = null;
      setPdfDirty(false);
      if (nextTab) setActiveTab(nextTab);
    },
    title: adminText("Discard changes?"),
    description: adminText("Your changes have not been saved."),
    confirmLabel: adminText("Discard changes"),
    cancelLabel: adminText("Keep editing"),
  });

  const changeTab = (tabId: string) => {
    const nextTab = tabId as BillingSettingsTab;
    if (nextTab === activeTab) return;
    if (activeTab === "pdf" && pdfDirty) {
      pendingTab.current = nextTab;
      pdfTabCloseGuard.requestClose();
      return;
    }
    setActiveTab(nextTab);
  };

  const buildPayload = (): BillingRateCardPayload => ({
    name: draft.name.trim(),
    currency: draft.currency.trim().toUpperCase(),
    storage_charge_basis: draft.storageChargeBasis,
    storage_gb_month_price: parsePrice(draft.storage),
    egress_gb_price: parsePrice(draft.egress),
    ingress_gb_price: parsePrice(draft.ingress),
    requests_per_1000_price: parsePrice(draft.requests),
    effective_from: draft.effectiveFrom,
    effective_to: draft.effectiveTo || null,
    storage_endpoint_id: draft.scope === "endpoint" ? Number(draft.endpointId) : null,
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!editor || validationError || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = buildPayload();
      if (editor.mode === "create") {
        await createBillingRateCard(payload);
        setMessage(adminText("Billing rate card created."));
      } else if (editor.mode === "edit" && editor.card) {
        await updateBillingRateCard(editor.card.id, payload);
        setMessage(adminText("Billing rate card updated."));
      } else if (editor.mode === "version" && editor.card) {
        await createBillingRateCardVersion(editor.card.id, {
          currency: payload.currency,
          storage_charge_basis: payload.storage_charge_basis,
          storage_gb_month_price: payload.storage_gb_month_price,
          egress_gb_price: payload.egress_gb_price,
          ingress_gb_price: payload.ingress_gb_price,
          requests_per_1000_price: payload.requests_per_1000_price,
          effective_from: payload.effective_from,
        });
        setMessage(adminText("New billing rate version created."));
      }
      closeEditor();
      await load();
    } catch (saveError) {
      setError(extractApiError(saveError, adminText("Unable to save billing rate card.")));
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (card: BillingRateCard) => {
    confirmation.requestConfirmation({
      title: adminText("Delete billing rate card?"),
      description: adminText("Delete this future tariff version."),
      confirmLabel: adminText("Delete rate card"),
      details: [
        { label: adminText("Name"), value: card.name },
        { label: adminText("Effective from"), value: card.effective_from },
      ],
      onConfirm: async () => {
        setBusy(true);
        setError(null);
        try {
          await deleteBillingRateCard(card.id);
          setMessage(adminText("Billing rate card deleted."));
          await load();
        } catch (deleteError) {
          setError(extractApiError(deleteError, adminText("Unable to delete billing rate card.")));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const columns: Array<DataTableColumn<BillingRateCard>> = [
    {
      id: "name",
      label: adminText("Name"),
      primary: true,
      render: (card) => <span className="font-medium">{card.name}</span>,
    },
    {
      id: "scope",
      label: adminText("Scope"),
      render: (card) =>
        card.storage_endpoint_id == null
          ? adminText("Global")
          : adminText("Endpoint") + " · " + (card.storage_endpoint_name ?? card.storage_endpoint_id),
    },
    { id: "currency", label: adminText("Currency"), render: (card) => card.currency },
    {
      id: "storage-basis",
      label: adminText("Storage billing"),
      render: (card) =>
        adminText(card.storage_charge_basis === "allocated_quota" ? "Allocated quota" : "Actual usage"),
    },
    {
      id: "storage",
      label: adminText("Storage / GiB-month"),
      render: (card) => card.storage_gb_month_price ?? "—",
    },
    { id: "egress", label: adminText("Egress / GiB"), render: (card) => card.egress_gb_price ?? "—" },
    { id: "ingress", label: adminText("Ingress / GiB"), render: (card) => card.ingress_gb_price ?? "—" },
    { id: "requests", label: adminText("Requests / 1,000"), render: (card) => card.requests_per_1000_price ?? "—" },
    {
      id: "period",
      label: adminText("Effective period"),
      render: (card) => card.effective_from + " → " + (card.effective_to ?? adminText("Current")),
    },
    {
      id: "status",
      label: adminText("Status"),
      render: (card) => (
        <ListBadge tone={statusTone(card.status)}>
          {adminText(
            card.status === "active" ? "Active" : card.status === "future" ? "Future" : "Expired",
          )}
        </ListBadge>
      ),
    },
    {
      id: "actions",
      label: adminText("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (card) => (
        <ListActions>
          {card.status === "active" && (
            <ListActionButton disabled={isDemo || busy} onClick={() => openVersion(card)}>
              {adminText("Create new version")}
            </ListActionButton>
          )}
          {card.editable && (
            <ListActionButton disabled={isDemo || busy} onClick={() => openEdit(card)}>
              {adminText("Edit")}
            </ListActionButton>
          )}
          {card.deletable && (
            <ListActionButton variant="danger" disabled={isDemo || busy} onClick={() => requestDelete(card)}>
              {adminText("Delete")}
            </ListActionButton>
          )}
          {card.status === "expired" && (
            <span className="text-[var(--ui-text-muted)]">{adminText("Read only")}</span>
          )}
        </ListActions>
      ),
    },
  ];

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: cards.length });
  const title =
    editor?.mode === "version"
      ? adminText("Create billing rate version")
      : editor?.mode === "edit"
        ? adminText("Edit billing rate card")
        : adminText("Create billing rate card");
  const lockedIdentity =
    editor?.mode === "version" ||
    (editor?.mode === "edit" && editor.card?.identity_editable === false);

  return (
    <div className="space-y-4">
      <PageHeader
        actionPresentation="listing"
        title={adminText("Billing settings")}
        description={adminText("Configure pricing, customer allocation, monthly automation, and statement presentation.")}
        breadcrumbs={breadcrumbs("billing-settings")}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {message && <PageBanner tone="success">{message}</PageBanner>}

      <PageTabs
        tabs={[
          {
            id: "pricing",
            label: adminText("Rate Plans"),
            content: (
              <ListPageSection
                variant="page"
                title={adminText("Billing rate cards")}
                countLabel={adminText(cards.length === 1 ? "{count} rate card" : "{count} rate cards", { count: cards.length })}
                actions={
                  <ListActions>
                    <ListActionButton onClick={() => void load()} loading={loading}>
                      {adminText("Refresh")}
                    </ListActionButton>
                    <ListActionButton variant="primary" disabled={isDemo || busy} onClick={openCreate}>
                      {adminText("Add rate card")}
                    </ListActionButton>
                  </ListActions>
                }
              >
                <DataTableShell
                  columns={columns}
                  rows={cards}
                  rowKey={(card) => card.id}
                  status={tableStatus}
                  loadingMessage={adminText("Loading billing rate cards...")}
                  errorMessage={error ?? adminText("Unable to load billing rate cards.")}
                  emptyMessage={adminText("No billing rate cards configured.")}
                  responsiveCards
                />
              </ListPageSection>
            ),
          },
          {
            id: "entities",
            label: adminText("Billing Entities"),
            content: <BillingEntitiesSettingsPanel rateCards={cards} />,
          },
          {
            id: "groups",
            label: adminText("Billing Groups"),
            content: <BillingGroupsSettingsPanel />,
          },
          {
            id: "automation",
            label: adminText("Automation"),
            content: <BillingAutomationSettingsPanel />,
          },
          {
            id: "pdf",
            label: adminText("Statement PDF"),
            content: <BillingStatementPdfSettingsPanel onDirtyChange={setPdfDirty} />,
          },
        ]}
        activeTab={activeTab}
        onChange={changeTab}
        variant="line"
        ariaLabel={adminText("Billing settings sections")}
        idPrefix="billing-settings"
      />
      {pdfTabCloseGuard.confirmationDialog}

      {editor && (
        <SettingsDialog title={title} onClose={closeGuard.requestClose} closeDisabled={busy} maxWidthClass="max-w-2xl">
          <form className="settings-stack" onSubmit={save} noValidate>
            <fieldset disabled={isDemo || busy} className="settings-fields">
              <div className="settings-fields sm:grid-cols-2">
                <UiInput
                  label={adminText("Name")}
                  value={draft.name}
                  disabled={lockedIdentity}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
                <UiSelect
                  label={adminText("Scope")}
                  value={draft.scope}
                  disabled={lockedIdentity}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      scope: event.target.value as Draft["scope"],
                      endpointId: "",
                    }))
                  }
                >
                  <option value="global">{adminText("Global")}</option>
                  <option value="endpoint">{adminText("S3 Endpoint")}</option>
                </UiSelect>
                {draft.scope === "endpoint" && (
                  <UiSelect
                    label={adminText("S3 Endpoint")}
                    value={draft.endpointId}
                    disabled={lockedIdentity}
                    onChange={(event) => setDraft((current) => ({ ...current, endpointId: event.target.value }))}
                  >
                    <option value="">{adminText("Select endpoint")}</option>
                    {endpoints.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>
                    ))}
                  </UiSelect>
                )}
                <UiInput
                  label={adminText("Currency")}
                  value={draft.currency}
                  maxLength={3}
                  onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))}
                />
                <UiSelect
                  label={adminText("Storage billing")}
                  value={draft.storageChargeBasis}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      storageChargeBasis: event.target.value as Draft["storageChargeBasis"],
                    }))
                  }
                  hint={adminText(
                    "Actual usage bills measured storage. Allocated quota bills reserved storage capacity.",
                  )}
                >
                  <option value="actual_usage">{adminText("Actual usage")}</option>
                  <option value="allocated_quota">{adminText("Allocated quota")}</option>
                </UiSelect>
              </div>

              <div className="settings-fields sm:grid-cols-2">
                {([
                  [
                    "storage",
                    draft.storageChargeBasis === "allocated_quota"
                      ? "Storage / allocated GiB-month"
                      : "Storage / measured GiB-month",
                  ],
                  ["egress", "Egress / GiB"],
                  ["ingress", "Ingress / GiB"],
                  ["requests", "Requests / 1,000"],
                ] as const).map(([key, label]) => (
                  <UiInput
                    key={key}
                    label={adminText(label)}
                    type="number"
                    min={0}
                    step="any"
                    value={draft[key]}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  />
                ))}
              </div>

              <div className="settings-fields sm:grid-cols-2">
                <UiInput
                  label={adminText("Effective from")}
                  type="date"
                  value={draft.effectiveFrom}
                  onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))}
                />
                {!lockedIdentity && (
                  <UiInput
                    label={adminText("Effective to")}
                    type="date"
                    value={draft.effectiveTo}
                    onChange={(event) => setDraft((current) => ({ ...current, effectiveTo: event.target.value }))}
                    hint={adminText("Optional. Use the last day of a month.")}
                  />
                )}
              </div>
            </fieldset>

            {attempted && validationError && <PageBanner tone="error">{validationError}</PageBanner>}
            <ModalActions>
              <SettingsButton type="button" variant="secondary" disabled={busy} onClick={closeGuard.requestClose}>
                {adminText("Cancel")}
              </SettingsButton>
              <SettingsButton type="submit" disabled={isDemo || busy}>
                {busy ? adminText("Saving...") : adminText(editor.mode === "version" ? "Create version" : "Save")}
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
