/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";

import { listS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listUserOptions } from "../../api/users";
import type { PaginatedResponse } from "../../api/types";
import {
  addAdminPortalRequestMessage,
  approveAdminPortalRequest,
  listAdminPortalRequests,
  rejectAdminPortalRequest,
  type PortalAdminRequest,
  type PortalAdminRequestStatus,
  type PortalAdminRequestType,
} from "../../api/portalRequests";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import PaginationControls from "../../components/PaginationControls";
import UserAvatar from "../../components/UserAvatar";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import useLazyListLoader from "../../hooks/useLazyListLoader";
import usePaginatedOptions, { type PaginatedOptionsQuery } from "../../hooks/usePaginatedOptions";
import { collectPaginatedItems } from "../../utils/pagination";
import {
  cx,
  uiDividerClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "../../utils/dateTime";
import {
  PortalRequestStatusBadge,
  portalRequestPayloadSummary,
  portalRequestReason,
  portalRequestTypeLabel,
} from "../shared/portalRequestsPresentation";
import { useAdminPageBreadcrumbs } from "./adminBreadcrumbs";
import { AssociationRoleTooltip, uiPrincipalRoleLabel } from "./AssociationSummary";
import { buildAdminPrincipalEditHref } from "./adminPrincipalEditLink";
import { useAdminI18n } from "./adminI18n";
import useAdminListController from "./useAdminListController";

type StatusFilter = PortalAdminRequestStatus | "all";
type TypeFilter = PortalAdminRequestType | "all";
type BusyAction = string | null;

const loadAccountOptions = async (
  query: PaginatedOptionsQuery,
): Promise<PaginatedResponse<S3AccountSummary>> => listS3Accounts(query);

const loadRequesterOptions = () => collectPaginatedItems((page) =>
  listUserOptions({ page, page_size: 100 }),
);

export default function AdminPortalRequestsPage() {
  const { text: adminText } = useAdminI18n();
  const adminBreadcrumbs = useAdminPageBreadcrumbs();
  const accountCatalog = usePaginatedOptions(loadAccountOptions, { initialPageSize: 25 });
  const {
    items: requesters,
    refresh: refreshRequesters,
  } = useLazyListLoader(loadRequesterOptions);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [selectedAccountOption, setSelectedAccountOption] = useState<S3AccountSummary | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [messageDrafts, setMessageDrafts] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);

  useEffect(() => {
    void refreshRequesters();
  }, [refreshRequesters]);

  const accountOptions = useMemo(() => {
    if (
      selectedAccountOption &&
      !accountCatalog.items.some((account) => account.id === selectedAccountOption.id)
    ) {
      return [selectedAccountOption, ...accountCatalog.items];
    }
    return accountCatalog.items;
  }, [accountCatalog.items, selectedAccountOption]);

  const requestersById = useMemo(
    () => new Map(requesters.map((requester) => [requester.id, requester])),
    [requesters],
  );

  const fetchRequests = useCallback(
    () =>
      listAdminPortalRequests({
        status: statusFilter,
        request_type: typeFilter,
        account_id: accountFilter === "all" ? "all" : Number(accountFilter),
        search,
        limit: 200,
      }),
    [accountFilter, search, statusFilter, typeFilter],
  );
  const formatLoadError = useCallback(
    (error: unknown) => {
      console.error(error);
      return extractApiError(error, adminText("Unable to load Portal requests."));
    },
    [adminText],
  );
  const {
    items: requests,
    setItems: setRequests,
    loading,
    error,
    setError,
    refresh: loadRequests,
  } = useAdminListController<PortalAdminRequest>({
    loadItems: fetchRequests,
    formatError: formatLoadError,
  });

  useEffect(() => {
    setExpandedId((current) => (
      current && requests.some((request) => request.id === current) ? current : null
    ));
  }, [requests]);

  const updateRequest = useCallback((updated: PortalAdminRequest) => {
    setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
    setExpandedId(updated.id);
  }, [setRequests]);

  const runAction = useCallback(async (
    request: PortalAdminRequest,
    action: "approve" | "reject" | "message"
  ) => {
    const draft = messageDrafts[request.id]?.trim() || "";
    setBusy(`${action}:${request.id}`);
    setError(null);
    setNotice(null);
    try {
      const updated =
        action === "approve"
          ? await approveAdminPortalRequest(request.id, { message: draft || null })
          : action === "reject"
            ? await rejectAdminPortalRequest(request.id, { message: draft || null })
            : await addAdminPortalRequestMessage(request.id, { message: draft });
      updateRequest(updated);
      setMessageDrafts((current) => ({ ...current, [request.id]: "" }));
      setNotice(adminText("Request updated."));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, adminText("Unable to update Portal request.")));
      await loadRequests();
    } finally {
      setBusy(null);
    }
  }, [adminText, loadRequests, messageDrafts, setError, updateRequest]);

  const columns = useMemo<Array<DataTableColumn<PortalAdminRequest>>>(
    () => [
      {
        id: "request",
        label: "Request",
        primary: true,
        render: (request) => (
          <div className="min-w-0">
            <p className={cx("truncate ui-body", uiTitleTextClass)}>{portalRequestTypeLabel(request.request_type)}</p>
            <p className={cx("mt-1 truncate ui-caption", uiMutedTextClass)}>{portalRequestPayloadSummary(request)}</p>
          </div>
        ),
      },
      {
        id: "status",
        label: "Status",
        render: (request) => <PortalRequestStatusBadge status={request.status} />,
      },
      {
        id: "account",
        label: "Account",
        render: (request) => request.account_name ?? request.account_id,
      },
      {
        id: "requester",
        label: "Requester",
        render: (request) => {
          const requester = request.requester_user_id != null
            ? requestersById.get(request.requester_user_id)
            : undefined;
          const label = requester?.full_name || request.requester_email;
          const roleLabel = uiPrincipalRoleLabel(requester?.role);
          const badge = (
            <>
              <UserAvatar
                name={label}
                email={request.requester_email}
                avatar={requester?.avatar}
                size="sm"
                decorative
              />
              <span className="min-w-0 truncate">{request.requester_email}</span>
            </>
          );
          const classes = "inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 pr-2.5 ui-caption font-semibold text-slate-800 transition dark:bg-slate-800 dark:text-slate-100";
          if (request.requester_user_id == null) {
            return (
              <AssociationRoleTooltip
                label={adminText("Requester")}
                entries={[{ key: request.requester_email, identity: `${label} · ${request.requester_email}`, roles: [roleLabel] }]}
                ariaLabel={`${request.requester_email}, role ${roleLabel}`}
                focusable
              >
                <span className={classes}>{badge}</span>
              </AssociationRoleTooltip>
            );
          }
          return (
            <AssociationRoleTooltip
              label={adminText("Requester")}
              entries={[{ key: String(request.requester_user_id), identity: `${label} · ${request.requester_email}`, roles: [roleLabel] }]}
              ariaLabel={`${request.requester_email}, role ${roleLabel}`}
            >
              <a
                href={buildAdminPrincipalEditHref({
                  id: request.requester_user_id,
                  kind: "user",
                  search: request.requester_email,
                })}
                aria-label={`Edit UI user ${label}`}
                className={`${classes} hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
              >
                {badge}
              </a>
            </AssociationRoleTooltip>
          );
        },
      },
      {
        id: "created",
        label: "Created",
        render: (request) => formatLocalDateTime(request.created_at),
      },
      {
        id: "actions",
        label: "Actions",
        align: "right",
        mobileRole: "actions",
        render: (request) => (
          <div className="flex flex-wrap justify-end gap-2">
            <ListActionButton
              variant="secondary"
              onClick={() => setExpandedId((current) => (current === request.id ? null : request.id))}
              {...dataTableDefaultActionProps}
            >
              {adminText("Details")}</ListActionButton>
            {request.status === "pending" ? (
              <>
                <ListActionButton variant="primary"
                  onClick={() => void runAction(request, "approve")}
                  loading={busy === `approve:${request.id}`}
                >
                  {adminText("Approve")}</ListActionButton>
                <ListActionButton
                  variant="danger"
                  onClick={() => void runAction(request, "reject")}
                  loading={busy === `reject:${request.id}`}
                >
                  {adminText("Reject")}</ListActionButton>
              </>
            ) : null}
          </div>
        ),
      },
    ],
    [adminText, busy, requestersById, runAction]
  );

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: requests.length });

  return (
    <PageShell actionPresentation="listing"
      title={adminText("Portal requests")}
      description={adminText("Review Portal membership and quota requests submitted by storage workspace users.")}
      breadcrumbs={adminBreadcrumbs("portal-requests")}
    >
      {notice ? <PageBanner tone="success">{notice}</PageBanner> : null}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}

      <ListPageSection
          title={adminText("Request queue")}
          variant="page"
          countLabel={`${requests.length} request(s)`}
          search={
            <UiInput
              aria-label={adminText("Search Portal requests")}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={adminText("Search requester, account, or payload")}
              size="compact"
              fieldClassName="min-w-[220px]"
            />
          }
          filters={
            <>
              <UiSelect
                label={adminText("Status")}
                aria-label={adminText("Filter by status")}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                size="compact"
              >
                <option value="pending">{adminText("Pending")}</option>
                <option value="processing">{adminText("Processing")}</option>
                <option value="approved">{adminText("Approved")}</option>
                <option value="rejected">{adminText("Rejected")}</option>
                <option value="failed">{adminText("Failed")}</option>
                <option value="all">{adminText("All statuses")}</option>
              </UiSelect>
              <UiSelect
                label={adminText("Type")}
                aria-label={adminText("Filter by type")}
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
                size="compact"
              >
                <option value="all">{adminText("All types")}</option>
                <option value="portal_user_access">{adminText("Add Portal collaborator")}</option>
                <option value="portal_user_removal">{adminText("Remove Portal user")}</option>
                <option value="account_quota_change">{adminText("Storage quota")}</option>
                <option value="portal_setting_change">{adminText("Project setting")}</option>
              </UiSelect>
              <div className="grid min-w-[240px] gap-2">
                <UiInput
                  label={adminText("Account search")}
                  aria-label={adminText("Search accounts")}
                  type="search"
                  value={accountCatalog.search}
                  onChange={(event) => accountCatalog.setSearch(event.target.value)}
                  size="compact"
                  placeholder={adminText("Search accounts")}
                />
                <UiSelect
                  label={adminText("Account")}
                  aria-label={adminText("Filter by account")}
                  value={accountFilter}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setAccountFilter(nextValue);
                    setSelectedAccountOption(
                      nextValue === "all"
                        ? null
                        : accountOptions.find((account) => String(account.id) === nextValue) ?? null,
                    );
                  }}
                  size="compact"
                >
                  <option value="all">{adminText("All accounts")}</option>
                  {accountOptions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </UiSelect>
                <PaginationControls
                  page={accountCatalog.page}
                  pageSize={accountCatalog.pageSize}
                  total={accountCatalog.total}
                  onPageChange={accountCatalog.setPage}
                  onPageSizeChange={accountCatalog.setPageSize}
                  disabled={accountCatalog.loading}
                />
              </div>
            </>
          }
          actions={
            <ListActionButton  variant="secondary" onClick={() => void loadRequests()} loading={loading}>
              {adminText("Refresh")}</ListActionButton>
          }
      >
        <DataTableShell
          columns={columns}
          rows={requests}
          rowKey={(request) => request.id}
          status={tableStatus}
          loadingMessage="Loading Portal requests..."
          errorMessage={error ?? "Unable to load Portal requests."}
          emptyMessage="No Portal requests match the current filters."
          responsiveCards
          expandedRow={(request) =>
            expandedId === request.id ? (
              <AdminPortalRequestDetails
                request={request}
                draft={messageDrafts[request.id] ?? ""}
                busy={busy}
                onDraftChange={(value) => setMessageDrafts((current) => ({ ...current, [request.id]: value }))}
                onAction={(action) => void runAction(request, action)}
              />
            ) : null
          }
        />
      </ListPageSection>
    </PageShell>
  );
}

function AdminPortalRequestDetails({
  request,
  draft,
  busy,
  onDraftChange,
  onAction,
}: {
  request: PortalAdminRequest;
  draft: string;
  busy: BusyAction;
  onDraftChange: (value: string) => void;
  onAction: (action: "approve" | "reject" | "message") => void;
}) {
  const { text: adminText } = useAdminI18n();
  const reason = portalRequestReason(request);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <DetailItem label={adminText("Type")} value={portalRequestTypeLabel(request.request_type)} />
        <DetailItem label={adminText("Payload")} value={portalRequestPayloadSummary(request)} />
        <DetailItem label={adminText("Decision")} value={request.decided_by_email ? `${request.decided_by_email} · ${formatLocalDateTime(request.decided_at)}` : "-"} />
      </div>
      {reason ? <DetailItem label={adminText("Reason")} value={reason} /> : null}
      {request.error_message ? <PageBanner tone="error">{request.error_message}</PageBanner> : null}
      <div className={cx("border-t pt-3", uiDividerClass)}>
        <p className={uiLabelClass}>{adminText("Messages")}</p>
        {request.messages.length > 0 ? (
          <div className="mt-2 grid gap-2">
            {request.messages.map((message) => (
              <div key={message.id}>
                <p className="ui-caption font-semibold text-[var(--ui-text)]">
                  {message.author_email} · {formatLocalDateTime(message.created_at)}
                </p>
                <p className={cx("mt-1 ui-body", uiMutedTextClass)}>{message.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className={cx("mt-2 ui-body", uiMutedTextClass)}>{adminText("No messages yet.")}</p>
        )}
      </div>
      <div className={cx("grid gap-3 border-t pt-3", uiDividerClass)}>
        <UiTextarea
          label={adminText("Message")}
          className="min-h-[84px]"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <UiButton size="sm" variant="secondary" onClick={() => onAction("message")} disabled={!draft.trim()} loading={busy === `message:${request.id}`}>
            {adminText("Send message")}</UiButton>
          {request.status === "pending" ? (
            <>
              <UiButton size="sm" onClick={() => onAction("approve")} loading={busy === `approve:${request.id}`}>
                {adminText("Approve")}</UiButton>
              <UiButton size="sm" variant="danger" onClick={() => onAction("reject")} loading={busy === `reject:${request.id}`}>
                {adminText("Reject")}</UiButton>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className={uiLabelClass}>{label}</p>
      <p className={cx("mt-1 break-words ui-body", uiTitleTextClass)}>{value}</p>
    </div>
  );
}
