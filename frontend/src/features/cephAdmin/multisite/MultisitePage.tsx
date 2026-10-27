/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { PageHeaderProps } from "../../../components/PageHeader";
import PageShell from "../../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../../components/PageTabs";
import UiBadge from "../../../components/ui/UiBadge";
import { useCephAdminI18n } from "../cephAdminI18n";
import { cephAdminPageBreadcrumbs } from "../cephAdminBreadcrumbs";

type MultisiteTab = "overview" | "bucket" | "logs";

const TAB_PATHS: Record<MultisiteTab, string> = {
  overview: "/ceph-admin/multisite",
  bucket: "/ceph-admin/multisite/bucket",
  logs: "/ceph-admin/multisite/logs",
};

type MultisitePageProps = {
  activeTab: MultisiteTab;
  children: ReactNode;
  actions?: PageHeaderProps["actions"];
};

export default function MultisitePage({ activeTab, children, actions }: MultisitePageProps) {
  const { text } = useCephAdminI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const navigateTab = (tab: string) => {
    const target = TAB_PATHS[tab as MultisiteTab];
    if (!target) return;
    const current = new URLSearchParams(location.search);
    const next = new URLSearchParams();
    const endpoint = current.get("ep");
    if (endpoint) next.set("ep", endpoint);
    const query = next.toString();
    navigate(query ? `${target}?${query}` : target);
  };

  return (
    <PageShell
      title={text("Multisite diagnostics")}
      description={text("Read-only Ceph multisite replication diagnostics for the selected endpoint.")}
      breadcrumbs={cephAdminPageBreadcrumbs("multisite")}
      actions={actions}
      inlineContent={<UiBadge tone="neutral">{text("Read only")}</UiBadge>}
    >
      <PageTabs
        tabs={[
          { id: "overview", label: text("Overview") },
          { id: "bucket", label: text("Bucket replication") },
          { id: "logs", label: text("Logs") },
        ]}
        activeTab={activeTab}
        onChange={navigateTab}
        variant="line"
        ariaLabel={text("Multisite views")}
        idPrefix="ceph-admin-multisite"
      />
      <PageTabPanel idPrefix="ceph-admin-multisite" tabId={activeTab}>{children}</PageTabPanel>
    </PageShell>
  );
}
