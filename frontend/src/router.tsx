/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Suspense, lazy, useMemo } from "react";
import { Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from "react-router-dom";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import FeatureDisabledPage from "./features/shared/FeatureDisabledPage";
import RouteErrorPage from "./features/shared/RouteErrorPage";
import ErrorState from "./components/errors/ErrorState";
import UnauthorizedPage from "./features/auth/UnauthorizedPage";
import {
  RequireAuth,
  RequireBrowserSurface,
  RequireCephAdminFeature,
  RequireManagerBucketCompareFeature,
  RequireManagerBucketIntegrityFeature,
  RequireManagerBucketPurgeFeature,
  RequireManagerAccess,
  RequireManagerFeature,
  RequireManagerFeatureRulesTool,
  RequireManagerIamFeature,
  RequireManagerMigrationFeature,
  RequirePortalAccess,
  RequireRole,
  RouteFallback,
  RequireStorageOpsFeature,
  RoleRedirect,
} from "./routerGuards";
import {
  DEFAULT_RUNTIME_SURFACES,
  type RuntimeSurfaces,
} from "./api/appSettings";

export { RequireManagerFeatureRulesTool, RequirePortalAccess } from "./routerGuards";

const LoginPage = lazy(() => import("./features/auth/LoginPage"));
const FirstAdminSetupPage = lazy(() => import("./features/auth/FirstAdminSetupPage"));
const OidcCallbackPage = lazy(() => import("./features/auth/OidcCallbackPage"));
const NotFoundPage = lazy(() => import("./features/auth/NotFoundPage"));
const S3AccountsPage = lazy(() => import("./features/admin/AccountsPage"));
const AccessAuditPage = lazy(() => import("./features/admin/AccessAuditPage"));
const AuditLogsPage = lazy(() => import("./features/admin/AuditLogsPage"));
const UsersPage = lazy(() => import("./features/admin/UsersPage"));
const GroupsPage = lazy(() => import("./features/admin/GroupsPage"));
const IdentitySecurityPage = lazy(() => import("./features/admin/IdentitySecurityPage"));
const AdminDashboard = lazy(() => import("./features/admin/AdminDashboard"));
const OnboardingPage = lazy(() => import("./features/admin/OnboardingPage"));
const ProductionReadinessPage = lazy(() => import("./features/admin/ProductionReadinessPage"));
const AdminMetricsPage = lazy(() => import("./features/admin/AdminMetricsPage"));
const AdminPortalRequestsPage = lazy(() => import("./features/admin/AdminPortalRequestsPage"));
const CostPage = lazy(() => import("./features/admin/CostPage"));
const CostSubjectDetailPage = lazy(() => import("./features/admin/CostSubjectDetailPage"));
const UsageHistoryPage = lazy(() => import("./features/admin/UsageHistoryPage"));
const S3UsersPage = lazy(() => import("./features/admin/S3UsersPage"));
const S3UserKeysPage = lazy(() => import("./features/admin/S3UserKeysPage"));
const S3ConnectionsPage = lazy(() => import("./features/admin/S3ConnectionsPage"));
const GeneralSettingsPage = lazy(() => import("./features/admin/GeneralSettingsPage"));
const CostSettingsPage = lazy(() => import("./features/admin/CostSettingsPage"));
const AuthenticationSettingsPage = lazy(() => import("./features/admin/AuthenticationSettingsPage"));
const ManagerSettingsPage = lazy(() => import("./features/admin/ManagerSettingsPage"));
const AdminPortalSettingsPage = lazy(() => import("./features/admin/PortalSettingsPage"));
const BrowserSettingsPage = lazy(() => import("./features/admin/BrowserSettingsPage"));
const WebhookSettingsPage = lazy(() => import("./features/admin/WebhookSettingsPage"));
const WebhookEndpointPage = lazy(() => import("./features/admin/WebhookEndpointPage"));
const AuthProviderPage = lazy(() => import("./features/admin/settings/AuthProviderPage"));
const KeyRotationPage = lazy(() => import("./features/admin/KeyRotationPage"));
const BucketsPage = lazy(() => import("./features/manager/BucketsPage"));
const ManagerDashboard = lazy(() => import("./features/manager/ManagerDashboard"));
const ManagerActivityPage = lazy(() => import("./features/manager/ManagerActivityPage"));
const PoliciesPage = lazy(() => import("./features/manager/PoliciesPage"));
const ManagerLayout = lazy(() => import("./features/manager/ManagerLayout"));
const StorageEndpointsPage = lazy(() => import("./features/admin/StorageEndpointsPage"));
const EndpointStatusPage = lazy(() => import("./features/admin/EndpointStatusPage"));
const EndpointStatusDetailPage = lazy(() => import("./features/admin/EndpointStatusDetailPage"));
const ManagerUsersPage = lazy(() => import("./features/manager/ManagerUsersPage"));
const ManagerUserDetailPage = lazy(() => import("./features/manager/ManagerUserDetailPage"));
const BucketDetailPage = lazy(() => import("./features/manager/BucketDetailPage"));
const BrowserPage = lazy(() => import("./features/browser/BrowserPage"));
const ManagerBrowserPage = lazy(() => import("./features/manager/ManagerBrowserPage"));
const ManagerGroupsPage = lazy(() => import("./features/manager/ManagerGroupsPage"));
const ManagerGroupDetailPage = lazy(() => import("./features/manager/ManagerGroupDetailPage"));
const ManagerRolesPage = lazy(() => import("./features/manager/ManagerRolesPage"));
const ManagerRoleWorkspacePage = lazy(() => import("./features/manager/ManagerRoleWorkspacePage"));
const ManagerMetricsPage = lazy(() => import("./features/manager/ManagerMetricsPage"));
const TopicsPage = lazy(() => import("./features/manager/TopicsPage"));
const ManagerTopicWorkspacePage = lazy(() => import("./features/manager/ManagerTopicWorkspacePage"));
const ManagerMigrationsPage = lazy(() => import("./features/manager/migrations/ManagerMigrationsListPage"));
const ManagerMigrationDetailPage = lazy(() => import("./features/manager/migrations/ManagerMigrationDetailPage"));
const ManagerMigrationWizardPage = lazy(() => import("./features/manager/migrations/ManagerMigrationWizardPage"));
const ManagerBucketComparePage = lazy(() => import("./features/manager/ManagerBucketComparePage"));
const ManagerBucketIntegrityPage = lazy(() => import("./features/manager/ManagerBucketIntegrityPage"));
const ManagerBucketPurgePage = lazy(() => import("./features/manager/ManagerBucketPurgePage"));
const ManagerFeatureRulesPage = lazy(() => import("./features/manager/ManagerFeatureRulesPage"));
const ManagerCephKeysPage = lazy(() => import("./features/manager/ManagerCephKeysPage"));
const PortalLayout = lazy(() => import("./features/portal/PortalLayout"));
const PortalDashboard = lazy(() => import("./features/portal/PortalDashboard"));
const PortalAccessKeysPage = lazy(() => import("./features/portal/PortalAccessKeysPage"));
const PortalStorageSpacesPage = lazy(() => import("./features/portal/PortalStorageSpacesPage"));
const PortalStorageSpaceDetailPage = lazy(() => import("./features/portal/PortalStorageSpaceDetailPage"));
const PortalSharesPage = lazy(() => import("./features/portal/PortalSharesPage"));
const PortalCollaboratorAccessPage = lazy(() => import("./features/portal/PortalCollaboratorAccessPage"));
const PortalRequestsPage = lazy(() => import("./features/portal/PortalRequestsPage"));
const PortalHistoryPage = lazy(() => import("./features/portal/PortalHistoryPage"));
const PortalUsagePage = lazy(() => import("./features/portal/PortalUsagePage"));
const PortalSettingsPage = lazy(() => import("./features/portal/PortalSettingsPage"));
const BrowserLayout = lazy(() => import("./features/browser/BrowserLayout"));
const CephAdminLayout = lazy(() => import("./features/cephAdmin/CephAdminLayout"));
const CephAdminDashboard = lazy(() => import("./features/cephAdmin/CephAdminDashboard"));
const CephAdminAccountsPage = lazy(() => import("./features/cephAdmin/CephAdminAccountsPage"));
const CephAdminUsersPage = lazy(() => import("./features/cephAdmin/CephAdminUsersPage"));
const CephAdminBucketsPage = lazy(() => import("./features/cephAdmin/CephAdminBucketsPage"));
const CephAdminMetricsPage = lazy(() => import("./features/cephAdmin/CephAdminMetricsPage"));
const MultisiteOverviewPage = lazy(() => import("./features/cephAdmin/multisite/MultisiteOverviewPage"));
const BucketReplicationPage = lazy(() => import("./features/cephAdmin/multisite/BucketReplicationPage"));
const MultisiteLogExplorerPage = lazy(() => import("./features/cephAdmin/multisite/MultisiteLogExplorerPage"));
const CephAdminBrowserPage = lazy(() => import("./features/cephAdmin/CephAdminBrowserPage"));
const StorageOpsLayout = lazy(() => import("./features/storageOps/StorageOpsLayout"));
const StorageOpsDashboard = lazy(() => import("./features/storageOps/StorageOpsDashboard"));
const StorageOpsBucketsPage = lazy(() => import("./features/storageOps/StorageOpsBucketsPage"));
const OpenStackCloudsPage = lazy(() => import("./features/admin/OpenStackCloudsPage"));
const StandaloneProfilePage = lazy(() => import("./features/shared/StandaloneProfilePage"));
const AccountProfilePage = lazy(() => import("./features/shared/AccountProfilePage"));
const AdminLayout = lazy(() => import("./features/admin/AdminLayout"));

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";
function AdminCostRoute({ detail = false }: { detail?: boolean }) {
  const { generalSettings } = useGeneralSettings();
  if (!generalSettings.cost_enabled) {
    return <FeatureDisabledPage feature={{
      en: "Cost",
      fr: "Coûts",
      de: "Kosten",
      zh: "成本",
    }} />;
  }
  return detail ? <CostSubjectDetailPage /> : <CostPage />;
}

function AdminUsageHistoryRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.usage_history_enabled ? <UsageHistoryPage /> : <FeatureDisabledPage feature={{
    en: "Usage history",
    fr: "Historique d'utilisation",
    de: "Nutzungsverlauf",
    zh: "用量历史",
  }} />;
}

function AdminPortalSettingsRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.portal_enabled ? <AdminPortalSettingsPage /> : <FeatureDisabledPage feature={{
    en: "Portal",
    fr: "Portail",
    de: "Portal",
    zh: "Portal",
  }} />;
}

function AdminEndpointStatusRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.endpoint_status_enabled
    ? <EndpointStatusPage />
    : <FeatureDisabledPage feature={{
        en: "Endpoint Status",
        fr: "État des endpoints",
        de: "Endpoint-Status",
        zh: "端点状态",
      }} />;
}

function AdminEndpointStatusDetailRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.endpoint_status_enabled
    ? <EndpointStatusDetailPage />
    : <FeatureDisabledPage feature={{
        en: "Endpoint Status",
        fr: "État des endpoints",
        de: "Endpoint-Status",
        zh: "端点状态",
      }} />;
}

export function createAppRoutes(runtimeSurfaces: RuntimeSurfaces = DEFAULT_RUNTIME_SURFACES) {
  return createRoutesFromElements(
    <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
      <Route element={<RequireAuth />}>
        <Route index element={<RoleRedirect />} />
        <Route path="/profile" element={<StandaloneProfilePage />} />

        {runtimeSurfaces.admin ? (
          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE]} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
                <Route index element={<AdminDashboard />} />
                <Route path="onboarding" element={<OnboardingPage />} />
                <Route path="profile" element={<AccountProfilePage />} />
                <Route path="s3-accounts" element={<S3AccountsPage />} />
                <Route path="s3-users" element={<S3UsersPage />} />
                <Route path="s3-connections" element={<S3ConnectionsPage />} />
                <Route path="s3-users/:userId/keys" element={<S3UserKeysPage />} />
                <Route path="storage-endpoints" element={<StorageEndpointsPage />} />
                <Route path="storage-endpoints/:endpointId" element={<StorageEndpointsPage />} />
                <Route path="endpoint-status" element={<AdminEndpointStatusRoute />} />
                <Route path="endpoint-status/:endpointId" element={<AdminEndpointStatusDetailRoute />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="groups" element={<GroupsPage />} />
                <Route path="identity-security" element={<IdentitySecurityPage />} />
                <Route path="access-audit" element={<AccessAuditPage />} />
                <Route path="audit" element={<AuditLogsPage />} />
                <Route path="metrics" element={<AdminMetricsPage />} />
                <Route path="portal-requests" element={<AdminPortalRequestsPage />} />
                <Route path="cost" element={<AdminCostRoute />} />
                <Route path="cost/subject/:subjectType/:subjectId" element={<AdminCostRoute detail />} />
                <Route path="usage-history" element={<AdminUsageHistoryRoute />} />
                <Route element={<RequireRole roles={[SUPERADMIN_ROLE]} />}>
                  <Route path="production-readiness" element={<ProductionReadinessPage />} />
                  <Route path="general-settings" element={<GeneralSettingsPage />} />
                  <Route path="cost-settings" element={<CostSettingsPage />} />
                  <Route path="openstack" element={<OpenStackCloudsPage />} />
                  <Route path="authentication-settings" element={<AuthenticationSettingsPage />} />
                  <Route path="authentication-settings/oidc/new" element={<AuthProviderPage kind="oidc" />} />
                  <Route path="authentication-settings/oidc/providers/:providerId" element={<AuthProviderPage kind="oidc" />} />
                  <Route path="authentication-settings/ldap/new" element={<AuthProviderPage kind="ldap" />} />
                  <Route path="authentication-settings/ldap/providers/:providerId" element={<AuthProviderPage kind="ldap" />} />
                  <Route path="manager-settings" element={<ManagerSettingsPage />} />
                  <Route path="portal-settings" element={<AdminPortalSettingsRoute />} />
                  <Route path="browser-settings" element={<BrowserSettingsPage />} />
                  <Route path="webhook-settings" element={<WebhookSettingsPage />} />
                  <Route path="webhook-settings/new" element={<WebhookEndpointPage />} />
                  <Route path="webhook-settings/:endpointId" element={<WebhookEndpointPage />} />
                  <Route path="key-rotation" element={<KeyRotationPage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Route>
        ) : null}

        {runtimeSurfaces.ceph_admin ? (
          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE]} />}>
            <Route element={<RequireCephAdminFeature />}>
              <Route path="/ceph-admin" element={<CephAdminLayout />}>
                <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
                  <Route index element={<CephAdminDashboard />} />
                  <Route path="profile" element={<AccountProfilePage />} />
                  <Route path="metrics" element={<CephAdminMetricsPage />} />
              <Route path="multisite" element={<MultisiteOverviewPage />} />
              <Route path="multisite/bucket" element={<BucketReplicationPage />} />
              <Route path="multisite/logs" element={<MultisiteLogExplorerPage />} />
                  <Route path="accounts" element={<CephAdminAccountsPage />} />
                  <Route path="users" element={<CephAdminUsersPage />} />
                  <Route path="buckets" element={<CephAdminBucketsPage />} />
                  {runtimeSurfaces.browser ? (
                    <Route element={<RequireBrowserSurface surface="ceph_admin" />}>
                      <Route path="browser" element={<CephAdminBrowserPage />} />
                    </Route>
                  ) : null}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
        ) : null}

        {runtimeSurfaces.storage_ops ? (
          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
            <Route element={<RequireStorageOpsFeature />}>
              <Route path="/storage-ops" element={<StorageOpsLayout />}>
                <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
                  <Route index element={<StorageOpsDashboard />} />
                  <Route path="profile" element={<AccountProfilePage />} />
                  <Route path="buckets" element={<StorageOpsBucketsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
        ) : null}

        <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
          {runtimeSurfaces.manager ? (
            <Route element={<RequireManagerFeature />}>
              <Route element={<RequireManagerAccess />}>
                <Route path="/manager" element={<ManagerLayout />}>
                  <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
                    <Route index element={<ManagerDashboard />} />
                    <Route path="activity" element={<ManagerActivityPage />} />
                    <Route path="profile" element={<AccountProfilePage />} />
                    <Route path="buckets" element={<BucketsPage />} />
                    <Route path="buckets/:bucketName" element={<BucketDetailPage />} />
                    {runtimeSurfaces.browser ? (
                      <Route element={<RequireBrowserSurface surface="manager" />}>
                        <Route path="browser" element={<ManagerBrowserPage />} />
                      </Route>
                    ) : null}
                    <Route path="metrics" element={<ManagerMetricsPage />} />
                    <Route element={<RequireManagerIamFeature />}>
                      <Route path="users" element={<ManagerUsersPage />} />
                      <Route path="users/:userName" element={<ManagerUserDetailPage />} />
                      <Route path="users/:userName/keys" element={<ManagerUserDetailPage />} />
                      <Route path="users/:userName/groups" element={<ManagerUserDetailPage />} />
                      <Route path="users/:userName/policies" element={<ManagerUserDetailPage />} />
                      <Route path="groups" element={<ManagerGroupsPage />} />
                      <Route path="groups/:groupName" element={<ManagerGroupDetailPage />} />
                      <Route path="groups/:groupName/members" element={<ManagerGroupDetailPage />} />
                      <Route path="groups/:groupName/policies" element={<ManagerGroupDetailPage />} />
                      <Route path="roles" element={<ManagerRolesPage />} />
                      <Route path="roles/:roleName" element={<ManagerRoleWorkspacePage />} />
                      <Route path="roles/:roleName/trust" element={<ManagerRoleWorkspacePage />} />
                      <Route path="roles/:roleName/policies" element={<ManagerRoleWorkspacePage />} />
                      <Route path="iam/policies" element={<PoliciesPage />} />
                    </Route>
                    <Route path="topics" element={<TopicsPage />} />
                    <Route path="topics/:topicName" element={<ManagerTopicWorkspacePage />} />
                    <Route path="topics/:topicName/policy" element={<ManagerTopicWorkspacePage />} />
                    <Route path="ceph/keys" element={<ManagerCephKeysPage />} />
                    <Route element={<RequireManagerBucketCompareFeature />}>
                      <Route path="bucket-compare" element={<ManagerBucketComparePage />} />
                    </Route>
                    <Route element={<RequireManagerBucketIntegrityFeature />}>
                      <Route path="bucket-integrity" element={<ManagerBucketIntegrityPage />} />
                    </Route>
                    <Route element={<RequireManagerBucketPurgeFeature />}>
                      <Route path="bucket-purge" element={<ManagerBucketPurgePage />} />
                    </Route>
                    <Route element={<RequireManagerFeatureRulesTool />}>
                      <Route path="feature-rules" element={<ManagerFeatureRulesPage />} />
                    </Route>
                    <Route element={<RequireManagerMigrationFeature />}>
                      <Route path="migrations" element={<ManagerMigrationsPage />} />
                      <Route path="migrations/new" element={<ManagerMigrationWizardPage />} />
                      <Route path="migrations/:migrationId" element={<ManagerMigrationDetailPage />} />
                    </Route>
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Route>
            </Route>
          ) : null}

          {runtimeSurfaces.browser ? (
            <Route element={<RequireBrowserSurface surface="root" />}>
              <Route path="/browser" element={<BrowserLayout />}>
                <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
                  <Route index element={<BrowserPage />} />
                  <Route path="profile" element={<AccountProfilePage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Route>
          ) : null}
        </Route>

        {runtimeSurfaces.portal ? (
          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
            <Route element={<RequirePortalAccess />}>
              <Route path="/portal" element={<PortalLayout />}>
                <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
                  <Route index element={<PortalDashboard />} />
                  <Route path="profile" element={<AccountProfilePage />} />
                  <Route path="storage-spaces" element={<PortalStorageSpacesPage />} />
                  <Route path="storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
                  <Route path="access-keys" element={<PortalAccessKeysPage />} />
                  <Route path="shares" element={<PortalSharesPage />} />
                  <Route path="shares/:userId" element={<PortalCollaboratorAccessPage />} />
                  <Route path="requests" element={<PortalRequestsPage />} />
                  <Route path="history" element={<PortalHistoryPage />} />
                  <Route path="usage" element={<PortalUsagePage />} />
                  <Route path="settings" element={<PortalSettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
        ) : null}
      </Route>

      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup/first-admin" element={<FirstAdminSetupPage />} />
      <Route path="/oidc/:provider/callback" element={<OidcCallbackPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route path="/session-expired" element={<ErrorState kind="session_expired" presentation="full" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  );
}

export default function AppRouter() {
  const { runtimeSurfaces, runtimeSurfacesLoading } = useGeneralSettings();
  const router = useMemo(() => {
    return createBrowserRouter(createAppRoutes(runtimeSurfaces), {
      future: { v7_relativeSplatPath: true },
    });
  }, [runtimeSurfaces]);
  if (runtimeSurfacesLoading) {
    return <RouteFallback />;
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
