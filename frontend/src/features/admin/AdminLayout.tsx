/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useLocation } from "react-router-dom";

import type { AdminPendingRequestCounts } from "../../api/adminNavigation";
import Layout from "../../components/Layout";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useAdminPendingRequestCounts } from "../../hooks/useAdminPendingRequestCounts";
import { interpolateText } from "../../i18n";
import {
  ADMIN_PAGE_CONTRACTS,
  workspacePageLink,
  type WorkspacePageContract,
} from "../../navigation/workspacePages";
import { isSuperAdminRole, readStoredUser } from "../../utils/workspaces";
import { useAdminI18n, type AdminTextValues } from "./adminI18n";
import { useOnboardingStatus } from "./useOnboardingStatus";

type AdminNavText = (message: string, values?: AdminTextValues) => string;

const ADMIN_SETTINGS_PATHS = [
  "/admin/general-settings",
  "/admin/cost-settings",
  "/admin/authentication-settings",
  "/admin/manager-settings",
  "/admin/browser-settings",
  "/admin/portal-settings",
  "/admin/webhook-settings",
  "/admin/production-readiness",
  "/admin/key-rotation",
];

function isAdminSettingsPath(pathname: string): boolean {
  return ADMIN_SETTINGS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function pageLink(page: WorkspacePageContract, text: AdminNavText) {
  return { ...workspacePageLink(page), label: text(page.label) };
}

const identityText: AdminNavText = interpolateText;

export const buildAdminNav = (
  portalEnabled: boolean,
  browserEnabled: boolean,
  costEnabled: boolean,
  usageHistoryEnabled: boolean,
  endpointStatusEnabled: boolean,
  isSuperAdmin: boolean,
  settingsExpanded = false,
  pendingRequestCounts: AdminPendingRequestCounts | null = null,
  showOnboarding = true,
  text: AdminNavText = identityText,
) => {
  const identityRequestCount = pendingRequestCounts?.identity_link_requests ?? 0;
  const portalRequestCount = pendingRequestCounts?.portal_requests ?? 0;
  const settingsLinks = [
    pageLink(ADMIN_PAGE_CONTRACTS["general-settings"], text),
    pageLink(ADMIN_PAGE_CONTRACTS["authentication-settings"], text),
    pageLink(ADMIN_PAGE_CONTRACTS["manager-settings"], text),
    {
      ...pageLink(ADMIN_PAGE_CONTRACTS["browser-settings"], text),
      disabled: !browserEnabled,
      disabledHint: !browserEnabled ? text("Browser feature is disabled in General settings.") : undefined,
    },
    {
      ...pageLink(ADMIN_PAGE_CONTRACTS["portal-settings"], text),
      disabled: !portalEnabled,
      disabledHint: !portalEnabled ? text("Portal feature is disabled in General settings.") : undefined,
    },
    pageLink(ADMIN_PAGE_CONTRACTS["cost-settings"], text),
    pageLink(ADMIN_PAGE_CONTRACTS["webhook-settings"], text),
    {
      ...pageLink(ADMIN_PAGE_CONTRACTS["production-readiness"], text),
      iconName: "shield" as const,
    },
    pageLink(ADMIN_PAGE_CONTRACTS["key-rotation"], text),
  ];

  return [
    {
      links: [{ ...pageLink(ADMIN_PAGE_CONTRACTS.dashboard, text), end: true, iconName: "home" as const }],
    },
    ...(showOnboarding
      ? [
          {
            label: text("Setup"),
            links: [
              {
                ...pageLink(ADMIN_PAGE_CONTRACTS.onboarding, text),
                iconName: "tools" as const,
              },
            ],
          },
        ]
      : []),
    {
      label: text("Identity & Access"),
      links: [
        pageLink(ADMIN_PAGE_CONTRACTS.users, text),
        pageLink(ADMIN_PAGE_CONTRACTS.groups, text),
        {
          ...pageLink(ADMIN_PAGE_CONTRACTS["identity-security"], text),
          iconName: "shield" as const,
          badge: identityRequestCount > 0 ? String(identityRequestCount) : undefined,
          badgeAriaLabel:
            identityRequestCount > 0
              ? text(
                  identityRequestCount === 1
                    ? "{count} pending identity link request"
                    : "{count} pending identity link requests",
                  { count: identityRequestCount },
                )
              : undefined,
          badgeTone: "attention" as const,
        },
      ],
    },
    {
      label: text("Managed Tenants"),
      links: [
        pageLink(ADMIN_PAGE_CONTRACTS.accounts, text),
        pageLink(ADMIN_PAGE_CONTRACTS["rgw-users"], text),
        pageLink(ADMIN_PAGE_CONTRACTS.metrics, text),
      ],
    },
    {
      label: text("Connections"),
      links: [pageLink(ADMIN_PAGE_CONTRACTS["shared-connections"], text)],
    },
    {
      label: text("Storage Backends"),
      links: [
        pageLink(ADMIN_PAGE_CONTRACTS["storage-endpoints"], text),
        ...(endpointStatusEnabled ? [pageLink(ADMIN_PAGE_CONTRACTS["endpoint-status"], text)] : []),
      ],
    },
    {
      label: text("Audit & Reporting"),
      links: [
        ...(portalEnabled
          ? [
              {
                ...pageLink(ADMIN_PAGE_CONTRACTS["portal-requests"], text),
                badge: portalRequestCount > 0 ? String(portalRequestCount) : undefined,
                badgeAriaLabel:
                  portalRequestCount > 0
                    ? text(
                        portalRequestCount === 1
                          ? "{count} pending Portal request"
                          : "{count} pending Portal requests",
                        { count: portalRequestCount },
                      )
                    : undefined,
                badgeTone: "attention" as const,
              },
            ]
          : []),
        ...(costEnabled ? [pageLink(ADMIN_PAGE_CONTRACTS.cost, text)] : []),
        ...(usageHistoryEnabled ? [pageLink(ADMIN_PAGE_CONTRACTS["usage-history"], text)] : []),
        pageLink(ADMIN_PAGE_CONTRACTS["access-audit"], text),
        pageLink(ADMIN_PAGE_CONTRACTS.audit, text),
      ],
    },
    ...(isSuperAdmin
      ? [
          {
            id: "settings",
            label: text("Settings"),
            links: settingsLinks,
            collapsed: !settingsExpanded,
            collapsible: true,
          },
        ]
      : []),
  ];
};

export default function AdminLayout() {
  const { generalSettings } = useGeneralSettings();
  const { status: onboardingStatus } = useOnboardingStatus();
  const location = useLocation();
  const pendingRequestCounts = useAdminPendingRequestCounts();
  const currentUser = readStoredUser();
  const canConfigureApp = isSuperAdminRole(currentUser?.role);
  const { text } = useAdminI18n();
  const adminNav = buildAdminNav(
    generalSettings.portal_enabled,
    generalSettings.browser_enabled,
    generalSettings.cost_enabled,
    generalSettings.usage_history_enabled,
    generalSettings.endpoint_status_enabled,
    canConfigureApp,
    isAdminSettingsPath(location.pathname),
    pendingRequestCounts,
    Boolean(onboardingStatus && !onboardingStatus.complete && !onboardingStatus.dismissed),
    text,
  );
  return (
    <Layout
      navSections={adminNav}
      headerTitle={text("Administration")}
      sidebarTitle={text("Admin")}
      hideHeader
    />
  );
}
