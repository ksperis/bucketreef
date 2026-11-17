/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { fetchStorageOpsSummary, type StorageOpsSummary } from "../../api/storageOps";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import { storageOpsPageBreadcrumbs } from "./storageOpsBreadcrumbs";
import { WorkspaceDashboardActionLink, WorkspaceDashboardCard } from "../../components/WorkspaceDashboardKit";
import { extractApiError } from "../../utils/apiError";
import { useI18n } from "../../i18n";

export default function StorageOpsDashboard() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<StorageOpsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStorageOpsSummary()
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setSummaryError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(extractApiError(err, t({
          en: "Unable to load Storage Ops summary.",
          fr: "Impossible de charger le résumé Storage Ops.",
          de: "Die Storage-Ops-Zusammenfassung konnte nicht geladen werden.",
          zh: "无法加载 Storage Ops 摘要。",
        })));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <PageShell
      title="Storage Ops"
      description={t({
        en: "Operations workspace for advanced S3 bucket administration across your authorized contexts.",
        fr: "Espace opérationnel pour l’administration avancée des Buckets S3 dans vos contextes autorisés.",
        de: "Arbeitsbereich für die erweiterte S3-Bucket-Administration in Ihren autorisierten Kontexten.",
        zh: "用于在已授权上下文中执行高级 S3 Bucket 管理的运维工作区。",
      })}
      breadcrumbs={storageOpsPageBreadcrumbs("dashboard", t({
        en: "Dashboard",
        fr: "Tableau de bord",
        de: "Dashboard",
        zh: "仪表盘",
      }))}
    >
      {summaryError && <PageBanner tone="error">{summaryError}</PageBanner>}
      <WorkspaceDashboardCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="ui-dashboard-note">
              {t({ en: "Managed contexts", fr: "Contextes gérés", de: "Verwaltete Kontexte", zh: "受管上下文" })}
            </p>
            <p className="ui-dashboard-value">
              {summary ? summary.total_contexts : "—"}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <p className="ui-dashboard-note">
              {t({ en: "Accounts", fr: "Comptes", de: "Konten", zh: "账户" })}: {summary?.total_accounts ?? "—"} |{" "}
              {t({ en: "S3 users", fr: "Utilisateurs S3", de: "S3-Benutzer", zh: "S3 用户" })}: {summary?.total_s3_users ?? "—"} |{" "}
              {t({ en: "Connections", fr: "Connexions", de: "Verbindungen", zh: "连接" })}: {summary?.total_connections ?? "—"} |{" "}
              {t({ en: "Shared", fr: "Partagées", de: "Freigegeben", zh: "共享" })}: {summary?.total_shared_connections ?? "—"} |{" "}
              {t({ en: "Private", fr: "Privées", de: "Privat", zh: "私有" })}: {summary?.total_private_connections ?? "—"} |{" "}
              {t({ en: "Endpoints", fr: "Endpoints", de: "Endpoints", zh: "Endpoint" })}: {summary?.total_endpoints ?? "—"}
            </p>
            <WorkspaceDashboardActionLink variant="primary" to="/storage-ops/buckets">
              {t({ en: "Open buckets", fr: "Ouvrir les Buckets", de: "Buckets öffnen", zh: "打开 Bucket" })}
            </WorkspaceDashboardActionLink>
          </div>
        </div>
      </WorkspaceDashboardCard>
    </PageShell>
  );
}
