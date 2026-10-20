/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";

import type { PortalAdminRequest } from "../../api/portalRequests";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PageBanner from "../../components/PageBanner";
import {
  cx,
  uiDividerClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatLocalDateTime } from "../../utils/dateTime";
import {
  PortalRequestStatusBadge,
  portalRequestPayloadSummary,
  portalRequestReason,
  portalRequestTypeLabel,
} from "../shared/portalRequestsPresentation";
import { PortalTabPanel } from "./PortalPageTabs";

type PortalRequestsHistoryProps = {
  requests: PortalAdminRequest[];
  loading: boolean;
  error: string | null;
};

export default function PortalRequestsHistory({
  requests,
  loading,
  error,
}: PortalRequestsHistoryProps) {
  const { t } = useI18n();
  const columns = useMemo<Array<DataTableColumn<PortalAdminRequest>>>(
    () => [
      {
        id: "request",
        label: t({ en: "Request", fr: "Demande", de: "Anfrage", zh: "请求" }),
        primary: true,
        render: (request) => (
          <div className="min-w-0">
            <p className={cx("truncate ui-body", uiTitleTextClass)}>
              {portalRequestTypeLabel(request.request_type)}
            </p>
            <p className={cx("mt-1 truncate ui-caption", uiMutedTextClass)}>
              {portalRequestPayloadSummary(request)}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        label: t({ en: "Status", fr: "Statut", de: "Status", zh: "状态" }),
        render: (request) => (
          <PortalRequestStatusBadge status={request.status} />
        ),
      },
      {
        id: "created",
        label: t({
          en: "Created",
          fr: "Créée",
          de: "Erstellt",
          zh: "创建时间",
        }),
        render: (request) => formatLocalDateTime(request.created_at),
      },
      {
        id: "updated",
        label: t({
          en: "Updated",
          fr: "Mise à jour",
          de: "Aktualisiert",
          zh: "更新时间",
        }),
        render: (request) =>
          formatLocalDateTime(request.decided_at ?? request.updated_at),
      },
    ],
    [t],
  );
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: requests.length,
  });

  return (
    <PortalTabPanel idPrefix="portal-help-requests" tabId="history">
      <ListPageSection
        title={t({
          en: "My help requests",
          fr: "Mes demandes",
          de: "Meine Hilfeanfragen",
          zh: "我的帮助请求",
        })}
        variant="page"
        countLabel={t({
          en: `${requests.length} request(s)`,
          fr: `${requests.length} demande(s)`,
          de: `${requests.length} Anfrage(n)`,
          zh: `${requests.length} 项请求`,
        })}
      >
        <DataTableShell
          columns={columns}
          rows={requests}
          rowKey={(request) => request.id}
          status={tableStatus}
          loadingMessage={t({
            en: "Loading requests...",
            fr: "Chargement des demandes...",
            de: "Anfragen werden geladen...",
            zh: "正在加载请求…",
          })}
          errorMessage={
            error ??
            t({
              en: "Unable to load requests.",
              fr: "Impossible de charger les demandes.",
              de: "Anfragen können nicht geladen werden.",
              zh: "无法加载请求。",
            })
          }
          emptyMessage={t({
            en: "No help requests yet.",
            fr: "Aucune demande d'aide pour le moment.",
            de: "Noch keine Hilfeanfragen.",
            zh: "暂无帮助请求。",
          })}
          responsiveCards
          expandedRow={(request) => <PortalRequestDetails request={request} />}
        />
      </ListPageSection>
    </PortalTabPanel>
  );
}

function PortalRequestDetails({ request }: { request: PortalAdminRequest }) {
  const { t } = useI18n();
  const reason = portalRequestReason(request);
  if (!reason && !request.error_message && request.messages.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-3">
      {reason ? (
        <div>
          <p className={uiLabelClass}>
            {t({ en: "Reason", fr: "Motif", de: "Grund", zh: "原因" })}
          </p>
          <p className="mt-1 ui-body">{reason}</p>
        </div>
      ) : null}
      {request.error_message ? (
        <PageBanner tone="error">{request.error_message}</PageBanner>
      ) : null}
      {request.messages.length > 0 ? (
        <div className={cx("border-t pt-3", uiDividerClass)}>
          <p className={uiLabelClass}>
            {t({
              en: "Messages",
              fr: "Messages",
              de: "Nachrichten",
              zh: "消息",
            })}
          </p>
          <div className="mt-2 grid gap-2">
            {request.messages.map((message) => (
              <div key={message.id} className="min-w-0">
                <p className="ui-caption font-semibold text-[var(--ui-text)]">
                  {message.author_email} ·{" "}
                  {formatLocalDateTime(message.created_at)}
                </p>
                <p className={cx("mt-1 ui-body", uiMutedTextClass)}>
                  {message.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
