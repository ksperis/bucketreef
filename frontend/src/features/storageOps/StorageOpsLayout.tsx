/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";
import {
  STORAGE_OPS_PAGE_CONTRACTS,
  workspacePageLink,
} from "../../navigation/workspacePages";
import { useI18n } from "../../i18n";

export default function StorageOpsLayout() {
  const { t } = useI18n();
  const navSections: SidebarSection[] = [
    {
      links: [{
        ...workspacePageLink(STORAGE_OPS_PAGE_CONTRACTS.dashboard),
        label: t({ en: "Dashboard", fr: "Tableau de bord", de: "Dashboard", zh: "仪表盘" }),
        end: true,
        iconName: "home",
      }],
    },
    {
      label: t({ en: "Operations", fr: "Opérations", de: "Operationen", zh: "操作" }),
      links: [{
        ...workspacePageLink(STORAGE_OPS_PAGE_CONTRACTS.buckets),
        label: t({ en: "Buckets", fr: "Buckets", de: "Buckets", zh: "Bucket" }),
      }],
    },
  ];

  return (
    <Layout
      navSections={navSections}
      headerTitle="Storage Ops"
      sidebarTitle="STORAGE OPS"
      hideHeader
    >
      <Outlet />
    </Layout>
  );
}
